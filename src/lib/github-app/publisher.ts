import { createHash } from "node:crypto";

import { GitHubInstallationClient } from "@/lib/github-app/client";
import { type GitHubRepository } from "@/lib/repositories/github";
import { PermanentTaskExecutionError } from "@/lib/workers/isolated/errors";
import { type ValidatedWorkspaceChange } from "@/lib/workers/isolated/workspace-changes";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const BRANCH_PATTERN = /^[a-z0-9._/-]+$/iu;

export type GitHubPublicationEvidence = {
  baseBranch: string;
  baseSha: string;
  branch: string;
  changedFiles: string[];
  cleanupWarnings?: string[];
  commitAuthor: string | null;
  commitSha: string;
  deliveryStatus: "merged" | "open";
  prAuthor: string;
  prNumber: number;
  prUrl: string;
};

type GitHubPullRequest = {
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  html_url: string;
  merged_at: string | null;
  number: number;
  state: string;
  user: { login: string };
};

const assertSafeBranch = (branch: string): void => {
  if (
    branch.length > 200 ||
    !BRANCH_PATTERN.test(branch) ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.includes("..") ||
    branch.includes("//")
  ) {
    throw new Error("A safe GitHub branch name is required.");
  }
};

const repositoryPath = (repository: GitHubRepository): string =>
  `/repos/${repository.owner}/${repository.name}`;

export const createPublicationBranch = ({
  baseSha,
  changes,
  taskIdentity,
}: {
  baseSha: string;
  changes: ValidatedWorkspaceChange[];
  taskIdentity: string;
}): string => {
  const digest = createHash("sha256")
    .update(taskIdentity)
    .update("\0")
    .update(baseSha)
    .update("\0")
    .update(
      changes
        .map(({ contentBase64 = "", mode = "", path, status }) =>
          [path, status, mode, contentBase64].join("\0"),
        )
        .join("\0"),
    )
    .digest("hex")
    .slice(0, 12);

  return `outcomes/task-${digest}`;
};

export const publishGitHubPullRequest = async ({
  assertLease = async () => undefined,
  baseBranch,
  baseSha,
  branch,
  changes,
  client,
  commitMessage,
  pullRequestBody,
  pullRequestTitle,
  repository,
  signal,
}: {
  assertLease?: () => Promise<void>;
  baseBranch: string;
  baseSha: string;
  branch: string;
  changes: ValidatedWorkspaceChange[];
  client: GitHubInstallationClient;
  commitMessage: string;
  pullRequestBody: string;
  pullRequestTitle: string;
  repository: GitHubRepository;
  signal?: AbortSignal;
}): Promise<GitHubPublicationEvidence> => {
  const assertPublicationActive = async () => {
    if (signal?.aborted) {
      throw new Error("Publication was aborted after lease loss.");
    }

    await assertLease();
  };

  if (!SHA_PATTERN.test(baseSha)) {
    throw new Error("A full lowercase GitHub base SHA is required.");
  }

  assertSafeBranch(baseBranch);
  assertSafeBranch(branch);

  if (changes.length === 0) {
    throw new Error("At least one validated change is required for publication.");
  }

  const repositoryApiPath = repositoryPath(repository);
  const recoverExistingPublication = async (
    expectedCommitSha?: string,
  ): Promise<GitHubPublicationEvidence | null> => {
    const headQuery = encodeURIComponent(`${repository.owner}:${branch}`);
    const baseQuery = encodeURIComponent(baseBranch);
    await assertPublicationActive();
    const pullRequests = await client.request<GitHubPullRequest[]>(
      `${repositoryApiPath}/pulls?state=all&head=${headQuery}&base=${baseQuery}&per_page=100`,
      { signal },
    );
    const matches = pullRequests.filter(
      (pullRequest) =>
        pullRequest.base.ref === baseBranch &&
        pullRequest.base.sha === baseSha &&
        pullRequest.head.ref === branch &&
        (expectedCommitSha === undefined ||
          pullRequest.head.sha === expectedCommitSha),
    );

    if (matches.length > 1) {
      throw new PermanentTaskExecutionError(
        "publication_recovery_ambiguous",
        "Multiple pull requests match the deterministic publication identity.",
      );
    }

    let pullRequest = matches[0];

    if (!pullRequest) {
      return null;
    }

    await assertPublicationActive();
    const recoveredCommit = await client.request<{
      committer: { login?: string } | null;
      parents: Array<{ sha: string }>;
      sha: string;
    }>(`${repositoryApiPath}/git/commits/${pullRequest.head.sha}`, {
      signal,
    });

    if (
      recoveredCommit.sha !== pullRequest.head.sha ||
      recoveredCommit.parents.length !== 1 ||
      recoveredCommit.parents[0]?.sha !== baseSha
    ) {
      throw new PermanentTaskExecutionError(
        "publication_recovery_invalid",
        "The existing publication does not descend from the accepted base commit.",
      );
    }

    await assertPublicationActive();
    const existingBranch = await client.requestOrNull<{
      object: { sha: string; type: string };
    }>(
      `${repositoryApiPath}/git/ref/heads/${encodeURIComponent(branch)}`,
      { signal },
    );

    if (
      existingBranch &&
      (existingBranch.object.type !== "commit" ||
        existingBranch.object.sha !== recoveredCommit.sha)
    ) {
      throw new PermanentTaskExecutionError(
        "publication_recovery_invalid",
        "The deterministic publication branch points to different work.",
      );
    }

    await assertPublicationActive();
    const pullRequestFiles = await client.request<
      Array<{ filename: string }>
    >(`${repositoryApiPath}/pulls/${pullRequest.number}/files?per_page=100`, {
      signal,
    });
    const expectedFiles = changes.map(({ path }) => path).sort();
    const actualFiles = pullRequestFiles
      .map(({ filename }) => filename)
      .sort();

    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
      throw new PermanentTaskExecutionError(
        "publication_recovery_invalid",
        "The existing pull request changed-file scope is invalid.",
      );
    }

    let deliveryStatus: GitHubPublicationEvidence["deliveryStatus"];

    if (pullRequest.merged_at) {
      deliveryStatus = "merged";
    } else if (pullRequest.state === "open") {
      deliveryStatus = "open";
    } else if (pullRequest.state === "closed") {
      await assertPublicationActive();
      pullRequest = await client.request<GitHubPullRequest>(
        `${repositoryApiPath}/pulls/${pullRequest.number}`,
        {
          body: JSON.stringify({ state: "open" }),
          method: "PATCH",
          signal,
        },
      );

      if (
        pullRequest.state !== "open" ||
        pullRequest.merged_at ||
        pullRequest.base.ref !== baseBranch ||
        pullRequest.base.sha !== baseSha ||
        pullRequest.head.ref !== branch ||
        pullRequest.head.sha !== recoveredCommit.sha
      ) {
        throw new PermanentTaskExecutionError(
          "publication_reopen_failed",
          "The existing closed pull request could not be safely reopened.",
        );
      }

      deliveryStatus = "open";
    } else {
      throw new PermanentTaskExecutionError(
        "publication_recovery_invalid",
        "The existing pull request has an unsupported state.",
      );
    }

    return {
      baseBranch,
      baseSha,
      branch,
      changedFiles: actualFiles,
      commitAuthor: recoveredCommit.committer?.login ?? null,
      commitSha: recoveredCommit.sha,
      deliveryStatus,
      prAuthor: pullRequest.user.login,
      prNumber: pullRequest.number,
      prUrl: pullRequest.html_url,
    };
  };

  await assertPublicationActive();
  const baseRef = await client.request<{
    object: { sha: string; type: string };
  }>(
    `${repositoryApiPath}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
    { signal },
  );

  if (baseRef.object.type !== "commit" || baseRef.object.sha !== baseSha) {
    const recoveredPublication = await recoverExistingPublication();

    if (recoveredPublication) {
      return recoveredPublication;
    }

    throw new PermanentTaskExecutionError(
      "repository_base_stale",
      "The repository base branch moved after the task was accepted.",
      "The repository base branch moved after the immutable snapshot was selected.",
    );
  }

  await assertPublicationActive();
  const baseCommit = await client.request<{
    committer: { date: string };
    sha: string;
    tree: { sha: string };
  }>(`${repositoryApiPath}/git/commits/${baseSha}`, { signal });

  if (baseCommit.sha !== baseSha) {
    throw new PermanentTaskExecutionError(
      "repository_base_stale",
      "The accepted repository base commit is unavailable.",
      "GitHub did not return the requested base commit.",
    );
  }

  const baseCommitTimestamp = new Date(baseCommit.committer.date).getTime();

  if (!Number.isFinite(baseCommitTimestamp)) {
    throw new Error("The GitHub base commit has an invalid timestamp.");
  }

  const deterministicCommitDate = new Date(
    baseCommitTimestamp + 1_000,
  ).toISOString();
  const treeEntries = await Promise.all(
    changes.map(async (change) => {
      await assertPublicationActive();

      if (change.status === "deleted") {
        return {
          mode: "100644",
          path: change.path,
          sha: null,
          type: "blob",
        };
      }

      if (!change.contentBase64 || !change.mode) {
        throw new Error(`Validated content is missing for ${change.path}.`);
      }

      const blob = await client.request<{ sha: string }>(
        `${repositoryApiPath}/git/blobs`,
        {
          body: JSON.stringify({
            content: change.contentBase64,
            encoding: "base64",
          }),
          method: "POST",
          signal,
        },
      );

      return {
        mode: change.mode,
        path: change.path,
        sha: blob.sha,
        type: "blob",
      };
    }),
  );
  await assertPublicationActive();
  const tree = await client.request<{ sha: string; truncated: boolean }>(
    `${repositoryApiPath}/git/trees`,
    {
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: treeEntries,
      }),
      method: "POST",
      signal,
    },
  );

  if (tree.truncated) {
    throw new Error("GitHub truncated the publication tree.");
  }

  await assertPublicationActive();
  const commit = await client.request<{
    committer: { login?: string } | null;
    parents: Array<{ sha: string }>;
    sha: string;
  }>(`${repositoryApiPath}/git/commits`, {
    body: JSON.stringify({
      author: {
        date: deterministicCommitDate,
        email: "outcomes-bot@users.noreply.github.com",
        name: "Outcomes",
      },
      committer: {
        date: deterministicCommitDate,
        email: "outcomes-bot@users.noreply.github.com",
        name: "Outcomes",
      },
      message: commitMessage,
      parents: [baseSha],
      tree: tree.sha,
    }),
    method: "POST",
    signal,
  });

  if (commit.parents.length !== 1 || commit.parents[0]?.sha !== baseSha) {
    throw new PermanentTaskExecutionError(
      "publication_commit_invalid",
      "The deterministic publication commit is invalid.",
      "The publication commit does not descend from the pinned SHA.",
    );
  }

  const recoveredPublication = await recoverExistingPublication(commit.sha);

  if (recoveredPublication) {
    return recoveredPublication;
  }

  let branchCreated = false;
  let pullRequestCreated = false;
  let pullRequestNumber: number | null = null;

  try {
    await assertPublicationActive();
    const existingBranch = await client.requestOrNull<{
      object: { sha: string; type: string };
    }>(
      `${repositoryApiPath}/git/ref/heads/${encodeURIComponent(branch)}`,
      { signal },
    );

    if (existingBranch) {
      if (
        existingBranch.object.type !== "commit" ||
        existingBranch.object.sha !== commit.sha
      ) {
        throw new PermanentTaskExecutionError(
          "publication_recovery_invalid",
          "The deterministic publication branch points to different work.",
        );
      }
    } else {
      await assertPublicationActive();
      await client.request<{ ref: string }>(`${repositoryApiPath}/git/refs`, {
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: commit.sha,
        }),
        method: "POST",
        signal,
      });
      branchCreated = true;
    }

    await assertPublicationActive();
    const pullRequest = await client.request<GitHubPullRequest>(
      `${repositoryApiPath}/pulls`,
      {
        body: JSON.stringify({
          base: baseBranch,
          body: pullRequestBody,
          draft: true,
          head: branch,
          title: pullRequestTitle,
        }),
        method: "POST",
        signal,
      },
    );
    pullRequestCreated = true;
    pullRequestNumber = pullRequest.number;

    if (
      pullRequest.base.ref !== baseBranch ||
      pullRequest.base.sha !== baseSha ||
      pullRequest.head.ref !== branch ||
      pullRequest.head.sha !== commit.sha ||
      pullRequest.state !== "open" ||
      pullRequest.merged_at
    ) {
      throw new PermanentTaskExecutionError(
        "publication_recovery_invalid",
        "The created pull request does not match the accepted task.",
      );
    }

    await assertPublicationActive();
    const pullRequestFiles = await client.request<
      Array<{ filename: string }>
    >(`${repositoryApiPath}/pulls/${pullRequest.number}/files?per_page=100`, {
      signal,
    });
    const expectedFiles = changes.map(({ path }) => path).sort();
    const actualFiles = pullRequestFiles
      .map(({ filename }) => filename)
      .sort();

    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
      throw new PermanentTaskExecutionError(
        "publication_recovery_invalid",
        "The pull request changed-file scope differs from the validated workspace.",
      );
    }

    return {
      baseBranch,
      baseSha,
      branch,
      changedFiles: actualFiles,
      commitAuthor: commit.committer?.login ?? null,
      commitSha: commit.sha,
      deliveryStatus: "open",
      prAuthor: pullRequest.user.login,
      prNumber: pullRequest.number,
      prUrl: pullRequest.html_url,
    };
  } catch (error) {
    if (pullRequestCreated && pullRequestNumber !== null) {
      await client
        .requestWithoutResponse(
          `${repositoryApiPath}/pulls/${pullRequestNumber}`,
          {
            body: JSON.stringify({ state: "closed" }),
            method: "PATCH",
          },
        )
        .catch(() => undefined);
    }

    if (branchCreated) {
      await client
        .requestWithoutResponse(
          `${repositoryApiPath}/git/refs/heads/${encodeURIComponent(branch)}`,
          { method: "DELETE" },
        )
        .catch(() => undefined);
    }

    throw error;
  }
};
