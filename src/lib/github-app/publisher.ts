import { createHash } from "node:crypto";

import { GitHubInstallationClient } from "@/lib/github-app/client";
import { type GitHubRepository } from "@/lib/repositories/github";
import { type ValidatedWorkspaceChange } from "@/lib/workers/isolated/workspace-changes";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const BRANCH_PATTERN = /^[a-z0-9._/-]+$/iu;

export type GitHubPublicationEvidence = {
  baseBranch: string;
  baseSha: string;
  branch: string;
  changedFiles: string[];
  commitAuthor: string | null;
  commitSha: string;
  prAuthor: string;
  prNumber: number;
  prUrl: string;
};

type GitHubPullRequest = {
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  html_url: string;
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
        .map(({ contentBase64 = "", path, status }) =>
          [path, status, contentBase64].join("\0"),
        )
        .join("\0"),
    )
    .digest("hex")
    .slice(0, 12);

  return `outcomes/spike-${digest}`;
};

export const publishGitHubPullRequest = async ({
  baseBranch,
  baseSha,
  branch,
  changes,
  client,
  commitMessage,
  pullRequestBody,
  pullRequestTitle,
  repository,
}: {
  baseBranch: string;
  baseSha: string;
  branch: string;
  changes: ValidatedWorkspaceChange[];
  client: GitHubInstallationClient;
  commitMessage: string;
  pullRequestBody: string;
  pullRequestTitle: string;
  repository: GitHubRepository;
}): Promise<GitHubPublicationEvidence> => {
  if (!SHA_PATTERN.test(baseSha)) {
    throw new Error("A full lowercase GitHub base SHA is required.");
  }

  assertSafeBranch(baseBranch);
  assertSafeBranch(branch);

  if (changes.length === 0) {
    throw new Error("At least one validated change is required for publication.");
  }

  const repositoryApiPath = repositoryPath(repository);
  const baseRef = await client.request<{
    object: { sha: string; type: string };
  }>(
    `${repositoryApiPath}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
  );

  if (baseRef.object.type !== "commit" || baseRef.object.sha !== baseSha) {
    throw new Error(
      "The repository base branch moved after the immutable snapshot was selected.",
    );
  }

  const baseCommit = await client.request<{
    committer: { date: string };
    sha: string;
    tree: { sha: string };
  }>(`${repositoryApiPath}/git/commits/${baseSha}`);

  if (baseCommit.sha !== baseSha) {
    throw new Error("GitHub did not return the requested base commit.");
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
  const tree = await client.request<{ sha: string; truncated: boolean }>(
    `${repositoryApiPath}/git/trees`,
    {
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: treeEntries,
      }),
      method: "POST",
    },
  );

  if (tree.truncated) {
    throw new Error("GitHub truncated the publication tree.");
  }

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
  });

  if (commit.parents.length !== 1 || commit.parents[0]?.sha !== baseSha) {
    throw new Error("The publication commit does not descend from the pinned SHA.");
  }

  let branchCreated = false;
  let pullRequestCreated = false;
  let pullRequestNumber: number | null = null;

  try {
    const existingBranch = await client.requestOrNull<{
      object: { sha: string; type: string };
    }>(
      `${repositoryApiPath}/git/ref/heads/${encodeURIComponent(branch)}`,
    );

    if (existingBranch) {
      if (
        existingBranch.object.type !== "commit" ||
        existingBranch.object.sha !== commit.sha
      ) {
        throw new Error(
          "The deterministic publication branch already points to different work.",
        );
      }
    } else {
      await client.request<{ ref: string }>(`${repositoryApiPath}/git/refs`, {
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: commit.sha,
        }),
        method: "POST",
      });
      branchCreated = true;
    }

    const headQuery = encodeURIComponent(`${repository.owner}:${branch}`);
    const baseQuery = encodeURIComponent(baseBranch);
    const existingPullRequests = await client.request<GitHubPullRequest[]>(
      `${repositoryApiPath}/pulls?state=open&head=${headQuery}&base=${baseQuery}&per_page=10`,
    );
    const matchingPullRequest = existingPullRequests.find(
      (pullRequest) =>
        pullRequest.base.ref === baseBranch &&
        pullRequest.base.sha === baseSha &&
        pullRequest.head.ref === branch &&
        pullRequest.head.sha === commit.sha &&
        pullRequest.state === "open",
    );
    const pullRequest =
      matchingPullRequest ??
      (await client.request<GitHubPullRequest>(
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
        },
      ));
    pullRequestCreated = matchingPullRequest === undefined;
    pullRequestNumber = pullRequest.number;

    if (
      pullRequest.base.ref !== baseBranch ||
      pullRequest.base.sha !== baseSha ||
      pullRequest.head.ref !== branch ||
      pullRequest.head.sha !== commit.sha
    ) {
      throw new Error("The created pull request does not match the pinned contract.");
    }

    const pullRequestFiles = await client.request<
      Array<{ filename: string }>
    >(`${repositoryApiPath}/pulls/${pullRequest.number}/files?per_page=100`);
    const expectedFiles = changes.map(({ path }) => path).sort();
    const actualFiles = pullRequestFiles
      .map(({ filename }) => filename)
      .sort();

    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
      throw new Error(
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
