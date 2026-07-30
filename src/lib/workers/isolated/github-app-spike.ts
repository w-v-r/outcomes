import { createHash } from "node:crypto";

import {
  GitHubAppClient,
  GitHubInstallationClient,
  requireGitHubRepository,
} from "@/lib/github-app/client";
import { getGitHubAppConfig } from "@/lib/github-app/config";
import {
  createPublicationBranch,
  publishGitHubPullRequest,
  type GitHubPublicationEvidence,
} from "@/lib/github-app/publisher";
import { executeIsolatedCursorProcess } from "@/lib/workers/isolated/process";
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
    throw new Error("CURSOR_API_KEY is not configured.");
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
}): Promise<Result> => {
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

  try {
    return await operation(client);
  } finally {
    await client.revokeToken();
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
  baseBranch,
  baseSha,
  installationId,
  prompt,
  repositoryUrl,
}: {
  allowedPaths: string[];
  baseBranch: string;
  baseSha: string;
  installationId: number;
  prompt: string;
  repositoryUrl: string;
}): Promise<GitHubAppWorkerSpikeResult> => {
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new Error("A valid GitHub App installation ID is required.");
  }

  if (!SHA_PATTERN.test(baseSha)) {
    throw new Error("A full lowercase Git commit SHA is required.");
  }

  if (!prompt.trim()) {
    throw new Error("A bounded worker prompt is required.");
  }

  const repository = requireGitHubRepository(repositoryUrl);
  const appClient = new GitHubAppClient({
    config: getGitHubAppConfig(),
  });
  const taskIdentity = createTaskIdentity({
    baseSha,
    prompt,
    repositoryUrl: repository.url,
  });
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
    const repositoryDetails = await discoveryClient.request<{
      full_name: string;
      id: number;
    }>(`/repos/${repository.fullName}`);

    if (
      repositoryDetails.full_name.toLowerCase() !== repository.fullName ||
      !Number.isSafeInteger(repositoryDetails.id) ||
      repositoryDetails.id <= 0
    ) {
      throw new Error(
        "GitHub did not return the expected immutable repository identity.",
      );
    }

    repositoryId = repositoryDetails.id;
  } finally {
    await discoveryClient.revokeToken();
  }

  if (!repositoryId) {
    throw new Error(
      "The immutable GitHub repository identity was not established.",
    );
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

  try {
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
    });

    if (run.status !== "finished") {
      throw new Error(
        `The isolated Cursor run ended with status ${run.status}: ${run.error ?? "no error details"}`,
      );
    }

    const changes: ValidatedWorkspaceChange[] =
      await collectValidatedWorkspaceChanges({
        allowedPaths,
        baseSha,
        gitDirectory: workspace.gitDirectory,
        workspaceDirectory: workspace.workspaceDirectory,
      });
    const branch = createPublicationBranch({
      baseSha,
      changes,
      taskIdentity,
    });
    const publication = await withInstallationClient({
      appClient,
      installationId,
      operation: (client) =>
        publishGitHubPullRequest({
          baseBranch,
          baseSha,
          branch,
          changes,
          client,
          commitMessage: `Complete Outcomes task ${taskIdentity.slice(0, 12)}`,
          pullRequestBody: [
            "Created by the Outcomes isolated-worker spike.",
            "",
            `Pinned base: \`${baseSha}\``,
            `Cursor run: \`${run.runId}\``,
            "",
            "The GitHub installation credential was held by the deterministic publisher and was not provided to the worker agent.",
          ].join("\n"),
          pullRequestTitle: `Outcomes: ${prompt.split("\n", 1)[0]?.slice(0, 72)}`,
          repository,
        }),
      repositoryId,
      repositoryUrl: repository.url,
    });

    return {
      installationId,
      publication,
      repositoryId,
      repositoryUrl: repository.url,
      run,
    };
  } finally {
    await workspace.cleanup();
  }
};
