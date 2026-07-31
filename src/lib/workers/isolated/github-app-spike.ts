import { createHash } from "node:crypto";

import {
  GitHubAppClient,
  GitHubInstallationClient,
  requireGitHubRepository,
} from "@/lib/github-app/client";
import { getGitHubAppConfig } from "@/lib/github-app/config";
import { assertExecutionPermissions } from "@/lib/github-app/permissions";
import {
  createPublicationBranch,
  publishGitHubPullRequest,
  type GitHubPublicationEvidence,
} from "@/lib/github-app/publisher";
import { executeIsolatedCursorProcess } from "@/lib/workers/isolated/process";
import { PermanentTaskExecutionError } from "@/lib/workers/isolated/errors";
import {
  createIsolatedGitHubWorkspace,
  type IsolatedWorkspace,
} from "@/lib/workers/isolated/workspace";
import {
  collectValidatedWorkspaceChanges,
  type ValidatedWorkspaceChange,
} from "@/lib/workers/isolated/workspace-changes";
import { type IsolatedCursorRunResult } from "@/lib/workers/isolated/cursor-run";

const DEFAULT_MODEL_ID = "composer-2.5";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export type GitHubAppWorkerSpikeResult = {
  installationId: number;
  publication: GitHubPublicationEvidence;
  repositoryId: number;
  repositoryUrl: string;
  run: IsolatedCursorRunResult;
};

const requireCursorApiKey = (): string => {
  const apiKey = process.env.CURSOR_API_KEY?.trim();

  if (!apiKey) {
    throw new PermanentTaskExecutionError(
      "worker_configuration_invalid",
      "The isolated worker is not configured.",
      "CURSOR_API_KEY is not configured.",
    );
  }

  return apiKey;
};

const withInstallationClient = async <Result>({
  appClient,
  installationId,
  operation,
  repositoryId,
  repositoryUrl,
}: {
  appClient: GitHubAppClient;
  installationId: number;
  operation: (
    client: GitHubInstallationClient,
  ) => Promise<Result>;
  repositoryId: number;
  repositoryUrl: string;
}): Promise<{ cleanupWarning: string | null; result: Result }> => {
  const repository = requireGitHubRepository(repositoryUrl);
  const installationToken = await appClient.createInstallationToken({
    installationId,
    purpose: "publish",
    repository,
    repositoryId,
  });
  const client = new GitHubInstallationClient({
    token: installationToken.token,
  });

  let result: Result;

  try {
    result = await operation(client);
  } catch (error) {
    await client.revokeToken().catch(() => undefined);
    throw error;
  }

  try {
    await client.revokeToken();
    return { cleanupWarning: null, result };
  } catch {
    return {
      cleanupWarning:
        "The publication token could not be explicitly revoked after successful publication.",
      result,
    };
  }
};

const createTaskIdentity = ({
  baseSha,
  prompt,
  repositoryUrl,
}: {
  baseSha: string;
  prompt: string;
  repositoryUrl: string;
}): string =>
  createHash("sha256")
    .update(repositoryUrl)
    .update("\0")
    .update(baseSha)
    .update("\0")
    .update(prompt)
    .digest("hex");

export const runGitHubAppWorkerSpike = async ({
  allowedPaths,
  assertLease = async () => undefined,
  baseBranch,
  baseSha,
  expectedRepositoryId,
  installationId,
  onPrepublication,
  prompt,
  pullRequestTitle,
  recovery,
  repositoryUrl,
  signal,
  taskIdentity: providedTaskIdentity,
}: {
  allowedPaths: string[];
  assertLease?: () => Promise<void>;
  baseBranch: string;
  baseSha: string;
  expectedRepositoryId?: number;
  installationId: number;
  onPrepublication?: (input: {
    branch: string;
    changes: ValidatedWorkspaceChange[];
    run: IsolatedCursorRunResult;
  }) => Promise<void>;
  prompt: string;
  pullRequestTitle?: string;
  recovery?: {
    changes: ValidatedWorkspaceChange[];
    run: IsolatedCursorRunResult;
  };
  repositoryUrl: string;
  signal?: AbortSignal;
  taskIdentity?: string;
}): Promise<GitHubAppWorkerSpikeResult> => {
  const assertExecutionActive = async () => {
    if (signal?.aborted) {
      throw new Error("The isolated execution was aborted.");
    }

    await assertLease();
  };

  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new PermanentTaskExecutionError(
      "repository_configuration_invalid",
      "The repository execution configuration is invalid.",
      "A valid GitHub App installation ID is required.",
    );
  }

  if (!SHA_PATTERN.test(baseSha)) {
    throw new PermanentTaskExecutionError(
      "repository_configuration_invalid",
      "The repository execution configuration is invalid.",
      "A full lowercase Git commit SHA is required.",
    );
  }

  if (!prompt.trim()) {
    throw new PermanentTaskExecutionError(
      "worker_configuration_invalid",
      "The accepted worker prompt is invalid.",
      "A bounded worker prompt is required.",
    );
  }

  const repository = requireGitHubRepository(repositoryUrl);
  await assertExecutionActive();
  let appClient: GitHubAppClient;

  try {
    appClient = new GitHubAppClient({
      config: getGitHubAppConfig(),
    });
  } catch (error) {
    throw new PermanentTaskExecutionError(
      "worker_configuration_invalid",
      "The GitHub execution provider is not configured.",
      error instanceof Error ? error.message : String(error),
    );
  }
  const currentInstallation = await appClient.getInstallation(installationId);
  try {
    assertExecutionPermissions(currentInstallation);
  } catch (error) {
    throw new PermanentTaskExecutionError(
      "repository_access_revoked",
      "Repository access or required permissions are no longer available.",
      error instanceof Error ? error.message : String(error),
    );
  }
  const taskIdentity =
    providedTaskIdentity ??
    createTaskIdentity({
      baseSha,
      prompt,
      repositoryUrl: repository.url,
    });

  if (!/^[0-9a-f]{64}$/u.test(taskIdentity)) {
    throw new PermanentTaskExecutionError(
      "worker_configuration_invalid",
      "The accepted task identity is invalid.",
      "A deterministic 64-character task identity is required.",
    );
  }

  const discoveryToken = await appClient.createInstallationToken({
    installationId,
    purpose: "discover",
    repository,
  });
  const discoveryClient = new GitHubInstallationClient({
    token: discoveryToken.token,
  });
  let repositoryId: number | null = null;

  try {
    const repositoryApiPath = `/repos/${repository.fullName}`;
    const [repositoryDetails, baseRef, baseCommit] = await Promise.all([
      discoveryClient.request<{
        full_name: string;
        id: number;
      }>(repositoryApiPath),
      discoveryClient.request<{
        object: { sha: string; type: string };
      }>(
        `${repositoryApiPath}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
      ),
      discoveryClient.request<{ sha: string }>(
        `${repositoryApiPath}/git/commits/${baseSha}`,
      ),
    ]);

    if (
      repositoryDetails.full_name.toLowerCase() !== repository.fullName ||
      !Number.isSafeInteger(repositoryDetails.id) ||
      repositoryDetails.id <= 0 ||
      (expectedRepositoryId !== undefined &&
        repositoryDetails.id !== expectedRepositoryId)
    ) {
      throw new PermanentTaskExecutionError(
        "repository_identity_mismatch",
        "The repository identity no longer matches the accepted task.",
        "GitHub did not return the expected immutable repository identity.",
      );
    }

    if (
      baseCommit.sha !== baseSha ||
      (!recovery &&
        (baseRef.object.type !== "commit" ||
          baseRef.object.sha !== baseSha))
    ) {
      throw new PermanentTaskExecutionError(
        "repository_base_stale",
        "The repository base branch moved after the task was accepted.",
        "The repository base branch no longer matches the accepted commit.",
      );
    }

    repositoryId = repositoryDetails.id;
  } finally {
    await discoveryClient.revokeToken();
  }

  if (!repositoryId) {
    throw new PermanentTaskExecutionError(
      "repository_identity_mismatch",
      "The repository identity could not be established.",
      "The immutable GitHub repository identity was not established.",
    );
  }
  await assertExecutionActive();

  const publishValidatedChanges = async (
    run: IsolatedCursorRunResult,
    changes: ValidatedWorkspaceChange[],
  ): Promise<GitHubAppWorkerSpikeResult> => {
    await assertExecutionActive();
    const branch = createPublicationBranch({
      baseSha,
      changes,
      taskIdentity,
    });
    await onPrepublication?.({ branch, changes, run });
    await assertExecutionActive();
    const publicationResult = await withInstallationClient({
      appClient,
      installationId,
      operation: (client) =>
        publishGitHubPullRequest({
          assertLease: assertExecutionActive,
          baseBranch,
          baseSha,
          branch,
          changes,
          client,
          commitMessage: `Complete Outcomes task ${taskIdentity.slice(0, 12)}`,
          pullRequestBody: [
            "Created by the Outcomes isolated worker.",
            "",
            `Task identity: \`${taskIdentity}\``,
            `Pinned base: \`${baseSha}\``,
            `Cursor run: \`${run.runId}\``,
            "",
            "The GitHub installation credential was held by the deterministic publisher and was not provided to the worker agent.",
          ].join("\n"),
          pullRequestTitle:
            pullRequestTitle ??
            `Outcomes: ${prompt.split("\n", 1)[0]?.slice(0, 72)}`,
          repository,
          signal,
        }),
      repositoryId,
      repositoryUrl: repository.url,
    });

    const publication = {
      ...publicationResult.result,
      ...(publicationResult.cleanupWarning
        ? { cleanupWarnings: [publicationResult.cleanupWarning] }
        : {}),
    };

    return {
      installationId,
      publication,
      repositoryId,
      repositoryUrl: repository.url,
      run,
    };
  };

  if (recovery) {
    if (
      recovery.run.status !== "finished" ||
      recovery.changes.length === 0
    ) {
      throw new PermanentTaskExecutionError(
        "publication_recovery_invalid",
        "Persisted publication recovery evidence is invalid.",
      );
    }

    return publishValidatedChanges(recovery.run, recovery.changes);
  }

  const cloneToken = await appClient.createInstallationToken({
    installationId,
    purpose: "clone",
    repository,
    repositoryId,
  });
  const cloneClient = new GitHubInstallationClient({
    token: cloneToken.token,
  });
  let workspace: IsolatedWorkspace | null = null;

  try {
    workspace = await createIsolatedGitHubWorkspace({
      baseSha,
      installationToken: cloneToken.token,
      repository,
    });
  } finally {
    try {
      await cloneClient.revokeToken();
    } catch (error) {
      await workspace?.cleanup();
      throw error;
    }
  }

  if (!workspace) {
    throw new Error("The isolated GitHub workspace was not created.");
  }

  let result: GitHubAppWorkerSpikeResult;

  try {
    await assertExecutionActive();
    const run = await executeIsolatedCursorProcess({
      apiKey: requireCursorApiKey(),
      input: {
        idempotencyKey: `outcomes-github-app-spike:${taskIdentity}`,
        modelId:
          process.env.OUTCOMES_CURSOR_MODEL?.trim() || DEFAULT_MODEL_ID,
        name: `Outcomes isolated spike ${taskIdentity.slice(0, 8)}`,
        prompt,
        workspaceDirectory: workspace.workspaceDirectory,
      },
      rootDirectory: workspace.rootDirectory,
      signal,
    });

    if (run.status !== "finished") {
      throw new Error(
        `The isolated Cursor run ended with status ${run.status}: ${run.error ?? "no error details"}`,
      );
    }

    let changes: ValidatedWorkspaceChange[];

    try {
      changes = await collectValidatedWorkspaceChanges({
        allowedPaths,
        baselineDirectory: workspace.baselineDirectory,
        workspaceDirectory: workspace.workspaceDirectory,
      });
    } catch (error) {
      throw new PermanentTaskExecutionError(
        "unsafe_worker_output",
        "The worker output violated the bounded change policy.",
        error instanceof Error ? error.message : String(error),
      );
    }

    await assertExecutionActive();
    result = await publishValidatedChanges(run, changes);
  } catch (error) {
    await workspace.cleanup().catch(() => undefined);
    throw error;
  }

  try {
    await workspace.cleanup();
  } catch {
    result.publication.cleanupWarnings = [
      ...(result.publication.cleanupWarnings ?? []),
      "The isolated workspace could not be fully removed after successful publication.",
    ];
  }

  return result;
};
