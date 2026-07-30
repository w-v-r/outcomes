import "server-only";

import { type CustomerPrincipal } from "@/lib/api-keys/service";
import { ControlPlaneError } from "@/lib/control-plane/errors";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  assertRepositoryBindingMatchesSnapshot,
  parseRepositorySnapshot,
  repositoryBindingSchema,
  type RepositoryBinding,
  type RepositorySnapshot,
} from "./domain";

type RepositoryBindingRow = {
  base_branch: string;
  base_sha: string;
  github_app_installation_id: string;
  github_installation_id: number | string;
  github_repository_id: number | string;
  id: string;
  manifest_hash: string;
  provider: "github";
  repository_full_name: string;
  repository_url: string;
  schema_version: number;
  snapshot_id: string;
  user_id: string;
  visibility: "internal" | "private" | "public";
};

type RepositorySnapshotRow = {
  commit_sha: string;
  github_repository_id: number | string;
  id: string;
  manifest: unknown;
  manifest_hash: string;
  repository_full_name: string;
  repository_url: string;
  scanner_id: string;
  scanner_version: string;
  schema_version: number;
  tree_sha: string;
  user_id: string;
  visibility: "internal" | "private" | "public";
};

export type OwnedRepositoryEvidence = {
  binding: RepositoryBinding;
  bindingId: string;
  snapshot: RepositorySnapshot;
  snapshotId: string;
  userId: string;
};

export type RepositoryEvidenceStore = {
  findBinding: (input: {
    bindingId: string;
    userId: string;
  }) => Promise<RepositoryBindingRow | null>;
  findSnapshot: (input: {
    snapshotId: string;
    userId: string;
  }) => Promise<RepositorySnapshotRow | null>;
};

const createRepositoryEvidenceStore = (): RepositoryEvidenceStore => {
  const admin = createAdminClient();

  if (!admin) {
    throw new ControlPlaneError({
      code: "service_unavailable",
      message: "Repository evidence storage is not configured.",
      status: 503,
    });
  }

  return {
    findBinding: async ({ bindingId, userId }) => {
      const { data, error } = await admin
        .from("repository_bindings")
        .select(
          "id, user_id, schema_version, provider, repository_url, repository_full_name, github_repository_id, base_branch, base_sha, visibility, github_app_installation_id, github_installation_id, snapshot_id, manifest_hash",
        )
        .eq("id", bindingId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw new ControlPlaneError({
          code: "database_error",
          message: "The repository binding could not be loaded.",
          status: 500,
        });
      }

      return (data as RepositoryBindingRow | null) ?? null;
    },
    findSnapshot: async ({ snapshotId, userId }) => {
      const { data, error } = await admin
        .from("repository_snapshots")
        .select(
          "id, user_id, schema_version, repository_url, repository_full_name, github_repository_id, visibility, commit_sha, tree_sha, scanner_id, scanner_version, manifest, manifest_hash",
        )
        .eq("id", snapshotId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw new ControlPlaneError({
          code: "database_error",
          message: "The repository snapshot could not be loaded.",
          status: 500,
        });
      }

      return (data as RepositorySnapshotRow | null) ?? null;
    },
  };
};

export const createRepositoryEvidenceLoader = (
  store: RepositoryEvidenceStore,
) => {
  return async (
    principal: CustomerPrincipal,
    bindingId: string,
  ): Promise<OwnedRepositoryEvidence> => {
    const bindingRow = await store.findBinding({
      bindingId,
      userId: principal.userId,
    });

    if (!bindingRow) {
      throw new ControlPlaneError({
        code: "repository_binding_not_found",
        message: "The repository binding was not found.",
        status: 404,
      });
    }

    const snapshotRow = await store.findSnapshot({
      snapshotId: bindingRow.snapshot_id,
      userId: principal.userId,
    });

    if (!snapshotRow) {
      throw new ControlPlaneError({
        code: "repository_snapshot_not_found",
        message: "The repository snapshot was not found.",
        status: 404,
      });
    }

    try {
      const snapshot = parseRepositorySnapshot({
        commitSha: snapshotRow.commit_sha,
        manifest: snapshotRow.manifest,
        manifestHash: snapshotRow.manifest_hash,
        repository: {
          canonicalUrl: snapshotRow.repository_url,
          fullName: snapshotRow.repository_full_name,
          githubRepositoryId: Number(snapshotRow.github_repository_id),
          visibility: snapshotRow.visibility,
        },
        scanner: {
          id: snapshotRow.scanner_id,
          version: snapshotRow.scanner_version,
        },
        schemaVersion: snapshotRow.schema_version,
        treeSha: snapshotRow.tree_sha,
      });
      const binding = repositoryBindingSchema.parse({
        accessBinding: {
          githubInstallationId: Number(
            bindingRow.github_installation_id,
          ),
          provider: "github_app",
          storedInstallationId:
            bindingRow.github_app_installation_id,
        },
        baseBranch: bindingRow.base_branch,
        baseSha: bindingRow.base_sha,
        manifestHash: bindingRow.manifest_hash,
        provider: bindingRow.provider,
        repository: {
          canonicalUrl: bindingRow.repository_url,
          fullName: bindingRow.repository_full_name,
          githubRepositoryId: Number(
            bindingRow.github_repository_id,
          ),
          visibility: bindingRow.visibility,
        },
        schemaVersion: bindingRow.schema_version,
        snapshotId: bindingRow.snapshot_id,
      });

      assertRepositoryBindingMatchesSnapshot({
        binding,
        snapshot,
        snapshotId: snapshotRow.id,
      });

      if (
        bindingRow.id !== bindingId ||
        bindingRow.user_id !== principal.userId ||
        snapshotRow.user_id !== principal.userId
      ) {
        throw new Error("Repository ownership evidence does not match.");
      }

      return {
        binding,
        bindingId: bindingRow.id,
        snapshot,
        snapshotId: snapshotRow.id,
        userId: principal.userId,
      };
    } catch {
      throw new ControlPlaneError({
        code: "invalid_repository_evidence",
        message:
          "The stored repository binding and snapshot evidence is invalid.",
        status: 409,
      });
    }
  };
};

export const loadOwnedRepositoryEvidence = async (
  principal: CustomerPrincipal,
  bindingId: string,
): Promise<OwnedRepositoryEvidence> =>
  createRepositoryEvidenceLoader(createRepositoryEvidenceStore())(
    principal,
    bindingId,
  );
