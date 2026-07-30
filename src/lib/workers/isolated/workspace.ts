import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { type GitHubRepository } from "@/lib/repositories/github";

const execFileAsync = promisify(execFile);

export type IsolatedWorkspace = {
  cleanup: () => Promise<void>;
  gitDirectory: string;
  rootDirectory: string;
  workspaceDirectory: string;
};

const runGit = async ({
  args,
  cwd,
  environment,
}: {
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
}): Promise<string> => {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: environment,
    maxBuffer: 2_000_000,
  });
  return stdout;
};

const getBaseEnvironment = ({
  homeDirectory,
}: {
  homeDirectory: string;
}): NodeJS.ProcessEnv => ({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: homeDirectory,
  LANG: "C.UTF-8",
  NODE_ENV: process.env.NODE_ENV,
  PATH: process.env.PATH ?? "/usr/bin:/bin",
});

export const createIsolatedGitHubWorkspace = async ({
  baseSha,
  installationToken,
  repository,
}: {
  baseSha: string;
  installationToken: string;
  repository: GitHubRepository;
}): Promise<IsolatedWorkspace> => {
  const rootDirectory = await mkdtemp(
    path.join(os.tmpdir(), "outcomes-worker-"),
  );
  const workspaceDirectory = path.join(rootDirectory, "workspace");
  const gitDirectory = path.join(rootDirectory, "git-metadata");
  const homeDirectory = path.join(rootDirectory, "git-home");
  const askPassPath = path.join(rootDirectory, "github-askpass.sh");
  const cleanup = async () => {
    await rm(rootDirectory, { force: true, recursive: true });
  };

  try {
    await Promise.all([
      mkdir(workspaceDirectory),
      mkdir(homeDirectory),
      writeFile(
        askPassPath,
        [
          "#!/bin/sh",
          'case "$1" in',
          '  *Username*) printf "%s\\n" "x-access-token" ;;',
          '  *Password*) printf "%s\\n" "$OUTCOMES_GITHUB_INSTALLATION_TOKEN" ;;',
          "  *) exit 1 ;;",
          "esac",
          "",
        ].join("\n"),
        { mode: 0o700 },
      ),
    ]);
    await chmod(askPassPath, 0o700);

    const baseEnvironment = getBaseEnvironment({ homeDirectory });
    await runGit({
      args: ["init", "--quiet"],
      cwd: workspaceDirectory,
      environment: baseEnvironment,
    });
    await runGit({
      args: ["remote", "add", "origin", `${repository.url}.git`],
      cwd: workspaceDirectory,
      environment: baseEnvironment,
    });
    await runGit({
      args: ["fetch", "--quiet", "--depth=1", "origin", baseSha],
      cwd: workspaceDirectory,
      environment: {
        ...baseEnvironment,
        GIT_ASKPASS: askPassPath,
        OUTCOMES_GITHUB_INSTALLATION_TOKEN: installationToken,
      },
    });
    await runGit({
      args: ["checkout", "--quiet", "--detach", "FETCH_HEAD"],
      cwd: workspaceDirectory,
      environment: baseEnvironment,
    });
    const checkedOutSha = (
      await runGit({
        args: ["rev-parse", "HEAD"],
        cwd: workspaceDirectory,
        environment: baseEnvironment,
      })
    ).trim();

    if (checkedOutSha !== baseSha) {
      throw new Error("GitHub returned a different commit than the pinned SHA.");
    }

    await runGit({
      args: ["remote", "remove", "origin"],
      cwd: workspaceDirectory,
      environment: baseEnvironment,
    });
    await rm(askPassPath, { force: true });
    await rename(path.join(workspaceDirectory, ".git"), gitDirectory);

    return {
      cleanup,
      gitDirectory,
      rootDirectory,
      workspaceDirectory,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
};
