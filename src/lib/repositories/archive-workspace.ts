import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { extract } from "tar";

import { GitHubAppRequestError } from "@/lib/github-app/client";
import { type GitHubRepository } from "@/lib/repositories/github";

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const MAX_ARCHIVE_COMPRESSED_BYTES = 100_000_000;
const MAX_ARCHIVE_EXTRACTED_BYTES = 100_000_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

type FetchImplementation = typeof fetch;

export type ReadOnlyRepositoryWorkspace = {
  cleanup: () => Promise<void>;
  rootDirectory: string;
  workspaceDirectory: string;
};

const createBoundedResponseStream = (
  body: ReadableStream<Uint8Array>,
): Readable => {
  return Readable.from(
    (async function* () {
      let receivedBytes = 0;

      for await (const chunk of body) {
        receivedBytes += chunk.byteLength;

        if (receivedBytes > MAX_ARCHIVE_COMPRESSED_BYTES) {
          throw new Error(
            `Repository archive exceeds the ${MAX_ARCHIVE_COMPRESSED_BYTES} byte download limit.`,
          );
        }

        yield Buffer.from(chunk);
      }
    })(),
  );
};

export const createReadOnlyGitHubArchiveWorkspace = async ({
  baseSha,
  fetchImplementation = fetch,
  installationToken,
  repository,
}: {
  baseSha: string;
  fetchImplementation?: FetchImplementation;
  installationToken: string;
  repository: GitHubRepository;
}): Promise<ReadOnlyRepositoryWorkspace> => {
  if (!SHA_PATTERN.test(baseSha)) {
    throw new Error("A full lowercase Git commit SHA is required.");
  }

  if (!installationToken.trim()) {
    throw new Error("A GitHub installation token is required.");
  }

  const rootDirectory = await mkdtemp(
    path.join(os.tmpdir(), "outcomes-snapshot-"),
  );
  const workspaceDirectory = path.join(rootDirectory, "workspace");
  const cleanup = async () => {
    await rm(rootDirectory, { force: true, recursive: true });
  };

  try {
    await mkdir(workspaceDirectory);
    const response = await fetchImplementation(
      `${GITHUB_API_URL}/repos/${repository.fullName}/tarball/${baseSha}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${installationToken}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        redirect: "follow",
      },
    );

    if (!response.ok || !response.body) {
      throw new GitHubAppRequestError(
        `GitHub repository archive download failed with status ${response.status}.`,
        response.status,
      );
    }

    let extractedBytes = 0;
    const unpack = extract({
      cwd: workspaceDirectory,
      filter: (_archivePath: string, entry) => {
        if (!("type" in entry)) {
          return false;
        }

        if (entry.type !== "File" && entry.type !== "Directory") {
          return false;
        }

        if (entry.type === "File") {
          extractedBytes += entry.size;

          if (extractedBytes > MAX_ARCHIVE_EXTRACTED_BYTES) {
            throw new Error(
              `Repository archive exceeds the ${MAX_ARCHIVE_EXTRACTED_BYTES} byte extraction limit.`,
            );
          }
        }

        return true;
      },
      maxDepth: 100,
      noMtime: true,
      preserveOwner: false,
      strict: true,
      strip: 1,
    });

    await pipeline(createBoundedResponseStream(response.body), unpack);

    return {
      cleanup,
      rootDirectory,
      workspaceDirectory,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
};
