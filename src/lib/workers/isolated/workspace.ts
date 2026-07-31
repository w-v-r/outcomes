import { cp } from "node:fs/promises";
import path from "node:path";

import { createReadOnlyGitHubArchiveWorkspace } from "@/lib/repositories/archive-workspace";
import { type GitHubRepository } from "@/lib/repositories/github";

export type IsolatedWorkspace = {
  baselineDirectory: string;
  cleanup: () => Promise<void>;
  rootDirectory: string;
  workspaceDirectory: string;
};

export const createIsolatedGitHubWorkspace = async ({
  baseSha,
  installationToken,
  repository,
}: {
  baseSha: string;
  installationToken: string;
  repository: GitHubRepository;
}): Promise<IsolatedWorkspace> => {
  const archiveWorkspace = await createReadOnlyGitHubArchiveWorkspace({
    baseSha,
    installationToken,
    repository,
  });
  const baselineDirectory = path.join(
    archiveWorkspace.rootDirectory,
    "baseline",
  );

  try {
    await cp(archiveWorkspace.workspaceDirectory, baselineDirectory, {
      errorOnExist: true,
      force: false,
      preserveTimestamps: false,
      recursive: true,
    });

    return {
      baselineDirectory,
      cleanup: archiveWorkspace.cleanup,
      rootDirectory: archiveWorkspace.rootDirectory,
      workspaceDirectory: archiveWorkspace.workspaceDirectory,
    };
  } catch (error) {
    await archiveWorkspace.cleanup();
    throw error;
  }
};
