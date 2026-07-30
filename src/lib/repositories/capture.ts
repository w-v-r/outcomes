import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  GitHubAppClient,
  GitHubInstallationClient,
  type GitHubInstallation,
} from "@/lib/github-app/client";
import { getGitHubAppConfig } from "@/lib/github-app/config";
import { assertExecutionPermissions } from "@/lib/github-app/permissions";
import {
  REPOSITORY_BINDING_SCHEMA_VERSION,
  REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
  assertRepositoryBindingMatchesSnapshot,
  calculateRepositoryManifestHash,
  githubBranchSchema,
  parseRepositorySnapshot,
  repositoryBindingSchema,
  type RepositoryBinding,
  type RepositorySnapshot,
} from "@/lib/repositories/domain";
import {
  parseGitHubRepository,
  type GitHubRepository,
} from "@/lib/repositories/github";
import {
  REPOSITORY_SCANNER_ID,
  REPOSITORY_SCANNER_VERSION,
  scanRepository,
} from "@/lib/repositories/scanner";
import {
  createIsolatedGitHubWorkspace,
  type IsolatedWorkspace,
} from "@/lib/workers/isolated/workspace";

const repositoryCaptureInputSchema = z
  .object({
    baseBranch: githubBranchSchema,
    baseSha: z.string().regex(/^[0-9a-f]{40}$/u),
    repositoryUrl: z.string().url(),
    storedInstallationId: z.string().uuid(),
    userId: z.string().uuid(),
  })
  .strict();

type StoredInstallationForCapture = {
  appId: number;
  disconnectedAt: string | null;
  id: string;
  installationId: number;
  permissions: Record<string, string>;
  suspendedAt: string | null;
  userId: string;
};

type RepositoryCaptureStore = {
  findInstallation: (input: {
    storedInstallationId: string;
    userId: string;
  }) => Promise<StoredInstallationForCapture | null>;
  persistBinding: (input: {
    binding: RepositoryBinding;
    id: string;
    userId: string;
  }) => Promise<string>;
  persistSnapshot: (input: {
    id: string;
    snapshot: RepositorySnapshot;
    userId: string;
  }) => Promise<string>;
};

type RepositoryCaptureDependencies = {
  appClient: Pick<
    GitHubAppClient,
    "createInstallationToken" | "getInstallation"
  >;
  createId: () => string;
  createInstallationClient: (
    token: string,
  ) => Pick<GitHubInstallationClient, "request" | "revokeToken">;
  createWorkspace: (input: {
    baseSha: string;
    installationToken: string;
    repository: GitHubRepository;
  }) => Promise<IsolatedWorkspace>;
  scanner: {
    id: string;
    scan: typeof scanRepository;
    version: string;
  };
  store: RepositoryCaptureStore;
};

export type RepositoryCaptureInput = z.infer<
  typeof repositoryCaptureInputSchema
>;

export type RepositoryCaptureResult = {
  binding: RepositoryBinding;
  bindingId: string;
  snapshot: RepositorySnapshot;
  snapshotId: string;
};

export class DeterministicRepositorySnapshotConflictError extends Error {
  constructor() {
    super(
      "The same repository snapshot identity produced a different manifest hash.",
    );
    this.name = "DeterministicRepositorySnapshotConflictError";
  }
}

export const resolveMatchingSnapshotId = ({
  existing,
  manifestHash,
}: {
  existing: { id: string; manifestHash: string } | null;
  manifestHash: string;
}): string | null => {
  if (!existing) {
    return null;
  }

  if (existing.manifestHash !== manifestHash) {
    throw new DeterministicRepositorySnapshotConflictError();
  }

  return existing.id;
};

const assertStoredInstallation = (
  installation: StoredInstallationForCapture,
  input: RepositoryCaptureInput,
): void => {
  if (
    installation.id !== input.storedInstallationId ||
    installation.userId !== input.userId
  ) {
    throw new Error(
      "The GitHub App installation does not belong to the requesting user.",
    );
  }

  if (installation.suspendedAt) {
    throw new Error("The Outcomes GitHub App installation is suspended.");
  }

  if (installation.disconnectedAt) {
    throw new Error("The Outcomes GitHub App installation is disconnected.");
  }

  if (
    installation.permissions.contents !== "write" ||
    installation.permissions.pull_requests !== "write"
  ) {
    throw new Error(
      "The Outcomes GitHub App installation no longer has the required repository permissions.",
    );
  }
};

const assertCurrentInstallation = ({
  current,
  stored,
}: {
  current: GitHubInstallation;
  stored: StoredInstallationForCapture;
}): void => {
  if (
    current.installationId !== stored.installationId ||
    current.appId !== stored.appId
  ) {
    throw new Error(
      "GitHub returned an installation that does not match the stored access binding.",
    );
  }

  assertExecutionPermissions(current);
};

const createSupabaseCaptureStore =
  async (): Promise<RepositoryCaptureStore> => {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();

  if (!admin) {
    throw new Error("Supabase admin access is not configured.");
  }

  const findSnapshot = async (
    snapshot: RepositorySnapshot,
    userId: string,
  ): Promise<string | null> => {
    const { data, error } = await admin
      .from("repository_snapshots")
      .select("id, manifest_hash")
      .eq("user_id", userId)
      .eq(
        "github_repository_id",
        snapshot.repository.githubRepositoryId,
      )
      .eq("repository_url", snapshot.repository.canonicalUrl)
      .eq("repository_full_name", snapshot.repository.fullName)
      .eq("visibility", snapshot.repository.visibility)
      .eq("commit_sha", snapshot.commitSha)
      .eq("tree_sha", snapshot.treeSha)
      .eq("scanner_id", snapshot.scanner.id)
      .eq("scanner_version", snapshot.scanner.version)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Unable to inspect repository snapshots: ${error.message}`,
      );
    }

    return resolveMatchingSnapshotId({
      existing: data
        ? { id: data.id, manifestHash: data.manifest_hash }
        : null,
      manifestHash: snapshot.manifestHash,
    });
  };

  const findBinding = async (
    binding: RepositoryBinding,
    userId: string,
  ): Promise<string | null> => {
    const { data, error } = await admin
      .from("repository_bindings")
      .select("id")
      .eq("user_id", userId)
      .eq(
        "github_repository_id",
        binding.repository.githubRepositoryId,
      )
      .eq("base_branch", binding.baseBranch)
      .eq("base_sha", binding.baseSha)
      .eq(
        "github_app_installation_id",
        binding.accessBinding.storedInstallationId,
      )
      .eq("snapshot_id", binding.snapshotId)
      .eq("manifest_hash", binding.manifestHash)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Unable to inspect repository bindings: ${error.message}`,
      );
    }

    return data?.id ?? null;
  };

  return {
    findInstallation: async ({ storedInstallationId, userId }) => {
      const { data, error } = await admin
        .from("github_app_installations")
        .select(
          "id, user_id, installation_id, app_id, permissions, suspended_at, disconnected_at",
        )
        .eq("id", storedInstallationId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw new Error(
          `Unable to inspect the GitHub App installation: ${error.message}`,
        );
      }

      if (!data) {
        return null;
      }

      return {
        appId: Number(data.app_id),
        disconnectedAt: data.disconnected_at,
        id: data.id,
        installationId: Number(data.installation_id),
        permissions: data.permissions as Record<string, string>,
        suspendedAt: data.suspended_at,
        userId: data.user_id,
      };
    },
    persistBinding: async ({ binding, id, userId }) => {
      const existingId = await findBinding(binding, userId);

      if (existingId) {
        return existingId;
      }

      const { data, error } = await admin
        .from("repository_bindings")
        .insert({
          base_branch: binding.baseBranch,
          base_sha: binding.baseSha,
          github_app_installation_id:
            binding.accessBinding.storedInstallationId,
          github_installation_id:
            binding.accessBinding.githubInstallationId,
          github_repository_id: binding.repository.githubRepositoryId,
          id,
          manifest_hash: binding.manifestHash,
          provider: binding.provider,
          repository_full_name: binding.repository.fullName,
          repository_url: binding.repository.canonicalUrl,
          schema_version: binding.schemaVersion,
          snapshot_id: binding.snapshotId,
          user_id: userId,
          visibility: binding.repository.visibility,
        })
        .select("id")
        .single();

      if (!error && data) {
        return data.id;
      }

      if (error?.code === "23505") {
        const concurrentId = await findBinding(binding, userId);

        if (concurrentId) {
          return concurrentId;
        }
      }

      throw new Error(
        `Unable to persist the repository binding: ${error?.message ?? "unknown database error"}`,
      );
    },
    persistSnapshot: async ({ id, snapshot, userId }) => {
      const existingId = await findSnapshot(snapshot, userId);

      if (existingId) {
        return existingId;
      }

      const { data, error } = await admin
        .from("repository_snapshots")
        .insert({
          commit_sha: snapshot.commitSha,
          github_repository_id: snapshot.repository.githubRepositoryId,
          id,
          manifest: snapshot.manifest,
          manifest_hash: snapshot.manifestHash,
          provider: "github",
          repository_full_name: snapshot.repository.fullName,
          repository_url: snapshot.repository.canonicalUrl,
          scanner_id: snapshot.scanner.id,
          scanner_version: snapshot.scanner.version,
          schema_version: snapshot.schemaVersion,
          tree_sha: snapshot.treeSha,
          user_id: userId,
          visibility: snapshot.repository.visibility,
        })
        .select("id")
        .single();

      if (!error && data) {
        return data.id;
      }

      if (error?.code === "23505") {
        const concurrentId = await findSnapshot(snapshot, userId);

        if (concurrentId) {
          return concurrentId;
        }
      }

      throw new Error(
        `Unable to persist the repository snapshot: ${error?.message ?? "unknown database error"}`,
      );
    },
  };
};

export const createRepositoryCaptureService = (
  dependencies: RepositoryCaptureDependencies,
) => {
  return async (
    inputValue: RepositoryCaptureInput,
  ): Promise<RepositoryCaptureResult> => {
    const input = repositoryCaptureInputSchema.parse(inputValue);
    const requestedRepository = parseGitHubRepository(input.repositoryUrl);

    if (
      !requestedRepository ||
      requestedRepository.url !== input.repositoryUrl
    ) {
      throw new Error("A canonical GitHub repository URL is required.");
    }

    const storedInstallation = await dependencies.store.findInstallation({
      storedInstallationId: input.storedInstallationId,
      userId: input.userId,
    });

    if (!storedInstallation) {
      throw new Error(
        "The GitHub App installation does not belong to the requesting user.",
      );
    }

    assertStoredInstallation(storedInstallation, input);
    const currentInstallation = await dependencies.appClient.getInstallation(
      storedInstallation.installationId,
    );
    assertCurrentInstallation({
      current: currentInstallation,
      stored: storedInstallation,
    });

    let discoveryClient:
      | Pick<GitHubInstallationClient, "request" | "revokeToken">
      | undefined;
    let scanClient:
      | Pick<GitHubInstallationClient, "request" | "revokeToken">
      | undefined;
    let workspace: IsolatedWorkspace | undefined;
    let operationFailed = false;
    let operationError: unknown;

    try {
      const discoveryToken =
        await dependencies.appClient.createInstallationToken({
          installationId: storedInstallation.installationId,
          purpose: "discover",
          repository: requestedRepository,
        });
      discoveryClient = dependencies.createInstallationClient(
        discoveryToken.token,
      );
      const repositoryApiPath =
        `/repos/${requestedRepository.owner}/${requestedRepository.name}`;
      const resolvedRepository = await discoveryClient.request<{
        full_name: string;
        html_url: string;
        id: number;
        visibility: "internal" | "private" | "public";
      }>(repositoryApiPath);
      const canonicalRepository = parseGitHubRepository(
        resolvedRepository.html_url,
      );

      if (
        !canonicalRepository ||
        canonicalRepository.url !== requestedRepository.url ||
        canonicalRepository.fullName !==
          resolvedRepository.full_name.toLowerCase() ||
        !Number.isSafeInteger(resolvedRepository.id) ||
        resolvedRepository.id <= 0
      ) {
        throw new Error(
          "GitHub returned repository identity that does not match the requested repository.",
        );
      }

      const baseRef = await discoveryClient.request<{
        object: { sha: string; type: string };
      }>(
        `${repositoryApiPath}/git/ref/heads/${encodeURIComponent(input.baseBranch)}`,
      );

      if (
        baseRef.object.type !== "commit" ||
        baseRef.object.sha !== input.baseSha
      ) {
        throw new Error(
          "The repository base branch does not point to the requested immutable SHA.",
        );
      }

      const commit = await discoveryClient.request<{
        sha: string;
        tree: { sha: string };
      }>(`${repositoryApiPath}/git/commits/${input.baseSha}`);

      if (
        commit.sha !== input.baseSha ||
        !/^[0-9a-f]{40}$/u.test(commit.tree.sha)
      ) {
        throw new Error(
          "GitHub did not return the requested commit and tree identity.",
        );
      }

      const scanToken = await dependencies.appClient.createInstallationToken({
        installationId: storedInstallation.installationId,
        purpose: "scan",
        repository: canonicalRepository,
        repositoryId: resolvedRepository.id,
      });
      scanClient = dependencies.createInstallationClient(scanToken.token);
      workspace = await dependencies.createWorkspace({
        baseSha: input.baseSha,
        installationToken: scanToken.token,
        repository: canonicalRepository,
      });
      const manifest = await dependencies.scanner.scan({
        expectedCommitSha: input.baseSha,
        rootPath: workspace.workspaceDirectory,
        source: {
          kind: "github",
          ref: input.baseSha,
          url: canonicalRepository.url,
        },
      });
      const snapshot = parseRepositorySnapshot({
        commitSha: input.baseSha,
        manifest,
        manifestHash: calculateRepositoryManifestHash(manifest),
        repository: {
          canonicalUrl: canonicalRepository.url,
          fullName: canonicalRepository.fullName,
          githubRepositoryId: resolvedRepository.id,
          visibility: resolvedRepository.visibility,
        },
        scanner: {
          id: dependencies.scanner.id,
          version: dependencies.scanner.version,
        },
        schemaVersion: REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
        treeSha: commit.tree.sha,
      });
      const snapshotId = await dependencies.store.persistSnapshot({
        id: dependencies.createId(),
        snapshot,
        userId: input.userId,
      });
      const binding = repositoryBindingSchema.parse({
        accessBinding: {
          githubInstallationId: storedInstallation.installationId,
          provider: "github_app",
          storedInstallationId: storedInstallation.id,
        },
        baseBranch: input.baseBranch,
        baseSha: input.baseSha,
        manifestHash: snapshot.manifestHash,
        provider: "github",
        repository: snapshot.repository,
        schemaVersion: REPOSITORY_BINDING_SCHEMA_VERSION,
        snapshotId,
      });
      assertRepositoryBindingMatchesSnapshot({
        binding,
        snapshot,
        snapshotId,
      });
      const bindingId = await dependencies.store.persistBinding({
        binding,
        id: dependencies.createId(),
        userId: input.userId,
      });

      return {
        binding,
        bindingId,
        snapshot,
        snapshotId,
      };
    } catch (error) {
      operationFailed = true;
      operationError = error;
      throw error;
    } finally {
      const cleanupResults = await Promise.allSettled([
        ...(workspace ? [workspace.cleanup()] : []),
        ...(scanClient ? [scanClient.revokeToken()] : []),
        ...(discoveryClient ? [discoveryClient.revokeToken()] : []),
      ]);
      const cleanupErrors = cleanupResults
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map(({ reason }) => reason);

      if (cleanupErrors.length > 0) {
        const errors = operationFailed
          ? [operationError, ...cleanupErrors]
          : cleanupErrors;

        throw new AggregateError(
          errors,
          operationFailed
            ? "Repository capture and cleanup failed."
            : "Repository capture cleanup failed.",
        );
      }
    }
  };
};

export const captureRepositoryPreflight = async (
  input: RepositoryCaptureInput,
): Promise<RepositoryCaptureResult> => {
  const config = getGitHubAppConfig();
  const appClient = new GitHubAppClient({ config });
  const capture = createRepositoryCaptureService({
    appClient,
    createId: randomUUID,
    createInstallationClient: (token) =>
      new GitHubInstallationClient({ token }),
    createWorkspace: createIsolatedGitHubWorkspace,
    scanner: {
      id: REPOSITORY_SCANNER_ID,
      scan: scanRepository,
      version: REPOSITORY_SCANNER_VERSION,
    },
    store: await createSupabaseCaptureStore(),
  });

  return capture(input);
};
