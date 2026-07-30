import { execFileSync } from "node:child_process";

import { normalizeGitHubRepositoryUrl } from "@outcomes/contracts";

export type GitExecutor = {
  exec: (args: string[], cwd: string) => string;
};

export type RepositoryDiscovery = {
  baseBranch: string;
  dirty: boolean;
  gitRoot: string;
  headSha: string;
  remoteBranchSha: string;
  remoteName: string;
  remoteUrl: string;
  repositoryUrl: string;
};

export type DiscoverRepositoryOptions = {
  allowDirty?: boolean;
  baseBranch?: string;
  cwd?: string;
  git: GitExecutor;
  remoteName?: string;
  requireRemoteSynced?: boolean;
};

export class RepositoryDiscoveryError extends Error {
  readonly code:
    | "detached"
    | "dirty"
    | "no_git"
    | "no_remote"
    | "not_github"
    | "unsynced";

  constructor(
    code: RepositoryDiscoveryError["code"],
    message: string,
  ) {
    super(message);
    this.name = "RepositoryDiscoveryError";
    this.code = code;
  }
}

const SHA40 = /^[0-9a-f]{40}$/u;

const trimOutput = (value: string) => value.trim();

export type CreateNodeGitExecutorOptions = {
  execTimeoutMs?: number;
};

export const createNodeGitExecutor = (
  options: CreateNodeGitExecutorOptions = {},
): GitExecutor => ({
  exec: (args, cwd) =>
    trimOutput(
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: options.execTimeoutMs ?? 30_000,
      }),
    ),
});

const resolveRemoteName = (
  git: GitExecutor,
  gitRoot: string,
  explicitRemote?: string,
): string => {
  if (explicitRemote) {
    git.exec(["remote", "get-url", explicitRemote], gitRoot);
    return explicitRemote;
  }

  try {
    const upstream = git.exec(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      gitRoot,
    );

    const remoteFromUpstream = upstream.split("/")[0];

    if (remoteFromUpstream) {
      git.exec(["remote", "get-url", remoteFromUpstream], gitRoot);
      return remoteFromUpstream;
    }
  } catch {
    /* fall through */
  }

  for (const candidate of ["upstream", "origin"]) {
    try {
      git.exec(["remote", "get-url", candidate], gitRoot);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new RepositoryDiscoveryError(
    "no_remote",
    "No GitHub remote was found. Add origin or upstream, or pass --remote.",
  );
};

export const discoverRepository = (
  options: DiscoverRepositoryOptions,
): RepositoryDiscovery => {
  const cwd = options.cwd ?? process.cwd();
  let gitRoot: string;

  try {
    gitRoot = options.git.exec(["rev-parse", "--show-toplevel"], cwd);
  } catch {
    throw new RepositoryDiscoveryError(
      "no_git",
      "This directory is not inside a Git repository.",
    );
  }

  let dirty = false;

  try {
    const status = options.git.exec(["status", "--porcelain"], gitRoot);
    dirty = status.length > 0;
  } catch {
    dirty = true;
  }

  if (dirty && !options.allowDirty) {
    throw new RepositoryDiscoveryError(
      "dirty",
      "The worktree has uncommitted changes. Commit or stash them before continuing.",
    );
  }

  const remoteName = resolveRemoteName(
    options.git,
    gitRoot,
    options.remoteName,
  );
  const remoteUrl = options.git.exec(
    ["remote", "get-url", remoteName],
    gitRoot,
  );
  const repositoryUrl = normalizeGitHubRepositoryUrl(remoteUrl);

  if (!repositoryUrl) {
    throw new RepositoryDiscoveryError(
      "not_github",
      `Remote ${remoteName} is not a supported GitHub repository URL.`,
    );
  }

  let headSha: string;

  try {
    headSha = options.git.exec(["rev-parse", "HEAD"], gitRoot).toLowerCase();
  } catch {
    throw new RepositoryDiscoveryError(
      "detached",
      "HEAD could not be resolved to a commit.",
    );
  }

  if (!SHA40.test(headSha)) {
    throw new RepositoryDiscoveryError(
      "detached",
      "HEAD must resolve to a full 40-character commit SHA.",
    );
  }

  let baseBranch = options.baseBranch?.trim() ?? "";

  if (!baseBranch) {
    try {
      baseBranch = options.git.exec(
        ["symbolic-ref", "--short", "HEAD"],
        gitRoot,
      );
    } catch {
      throw new RepositoryDiscoveryError(
        "detached",
        "Checkout a branch or pass --base explicitly.",
      );
    }
  }

  let remoteBranchSha: string;

  try {
    remoteBranchSha = options.git
      .exec(
        ["ls-remote", remoteName, `refs/heads/${baseBranch}`],
        gitRoot,
      )
      .split("\t")[0]
      ?.trim()
      .toLowerCase() ?? "";
  } catch {
    remoteBranchSha = "";
  }

  if (!SHA40.test(remoteBranchSha)) {
    throw new RepositoryDiscoveryError(
      "unsynced",
      `Remote branch ${remoteName}/${baseBranch} was not found. Push the branch before continuing.`,
    );
  }

  if (
    options.requireRemoteSynced !== false &&
    remoteBranchSha !== headSha
  ) {
    throw new RepositoryDiscoveryError(
      "unsynced",
      `Local HEAD (${headSha.slice(0, 12)}) does not match ${remoteName}/${baseBranch} (${remoteBranchSha.slice(0, 12)}). Push or reset before continuing.`,
    );
  }

  return {
    baseBranch,
    dirty,
    gitRoot,
    headSha,
    remoteBranchSha,
    remoteName,
    remoteUrl,
    repositoryUrl,
  };
};
