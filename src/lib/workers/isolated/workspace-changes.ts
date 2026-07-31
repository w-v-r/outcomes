import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const MAX_CHANGED_FILES = 25;
const MAX_FILE_BYTES = 500_000;
const MAX_SCANNED_FILES = 50_000;
const MAX_TOTAL_BYTES = 1_000_000;
const PROHIBITED_PATHS = new Set([
  ".gitmodules",
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const PROHIBITED_PATH_PREFIXES = [
  ".agents/",
  ".cursor/",
  ".git/",
  ".github/workflows/",
  ".githooks/",
];

export type ValidatedWorkspaceChange = {
  contentBase64?: string;
  mode?: "100644" | "100755";
  path: string;
  status: "added" | "deleted" | "modified";
};

export const assertPersistedWorkspaceChanges = ({
  allowedPaths,
  changes,
}: {
  allowedPaths: string[];
  changes: ValidatedWorkspaceChange[];
}): void => {
  if (
    changes.length === 0 ||
    changes.length > MAX_CHANGED_FILES ||
    allowedPaths.length === 0
  ) {
    throw new Error("Persisted workspace changes exceed the safe file scope.");
  }

  let totalBytes = 0;

  for (const change of changes) {
    if (
      !isSafeRepositoryPath(change.path) ||
      isProhibitedPath(change.path) ||
      !isAllowedPath({
        allowedPaths,
        changedPath: change.path,
      })
    ) {
      throw new Error("Persisted workspace changes contain an unsafe path.");
    }

    if (change.status === "deleted") {
      if (change.contentBase64 || change.mode) {
        throw new Error("Deleted workspace changes contain unexpected content.");
      }

      continue;
    }

    if (
      !change.contentBase64 ||
      !change.mode ||
      !["100644", "100755"].includes(change.mode)
    ) {
      throw new Error("Persisted workspace change content is incomplete.");
    }

    const content = Buffer.from(change.contentBase64, "base64");

    if (
      content.toString("base64") !== change.contentBase64 ||
      content.byteLength > MAX_FILE_BYTES ||
      content.includes(0)
    ) {
      throw new Error("Persisted workspace change content is unsafe.");
    }

    totalBytes += content.byteLength;

    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("Persisted workspace changes exceed the safe byte scope.");
    }
  }
};

const isSafeRepositoryPath = (value: string): boolean => {
  if (
    !value ||
    path.posix.isAbsolute(value) ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return false;
  }

  const normalizedPath = path.posix.normalize(value);
  return normalizedPath === value && !normalizedPath.startsWith("../");
};

const isAllowedPath = ({
  allowedPaths,
  changedPath,
}: {
  allowedPaths: string[];
  changedPath: string;
}): boolean =>
  allowedPaths.some((allowedPath) => {
    if (allowedPath.endsWith("/")) {
      return changedPath.startsWith(allowedPath);
    }

    return changedPath === allowedPath;
  });

const isProhibitedPath = (value: string): boolean =>
  PROHIBITED_PATHS.has(value) ||
  PROHIBITED_PATH_PREFIXES.some((prefix) => value.startsWith(prefix));

type WorkspaceFile = {
  content: Buffer;
  mode: "100644" | "100755";
};

const readWorkspaceFiles = async (
  rootDirectory: string,
): Promise<Map<string, WorkspaceFile>> => {
  const files = new Map<string, WorkspaceFile>();
  const pendingDirectories = [""];

  while (pendingDirectories.length > 0) {
    const relativeDirectory = pendingDirectories.pop()!;
    const absoluteDirectory = path.join(rootDirectory, relativeDirectory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;

      if (!isSafeRepositoryPath(relativePath)) {
        throw new Error("The worker produced an unsafe repository path.");
      }

      const absolutePath = path.join(rootDirectory, relativePath);
      const fileStat = await lstat(absolutePath);

      if (fileStat.isSymbolicLink()) {
        throw new Error(
          "Repositories containing symlinks or submodules are unsupported by the isolated worker.",
        );
      }

      if (fileStat.isDirectory()) {
        pendingDirectories.push(relativePath);
        continue;
      }

      if (!fileStat.isFile()) {
        throw new Error(
          `Only regular files may exist in the isolated workspace: ${relativePath}`,
        );
      }

      if (files.size >= MAX_SCANNED_FILES) {
        throw new Error(
          `The isolated workspace exceeds ${MAX_SCANNED_FILES} files.`,
        );
      }

      files.set(relativePath, {
        content: await readFile(absolutePath),
        mode: (fileStat.mode & 0o111) === 0 ? "100644" : "100755",
      });
    }
  }

  return files;
};

export const collectValidatedWorkspaceChanges = async ({
  allowedPaths,
  baselineDirectory,
  workspaceDirectory,
}: {
  allowedPaths: string[];
  baselineDirectory: string;
  workspaceDirectory: string;
}): Promise<ValidatedWorkspaceChange[]> => {
  if (
    allowedPaths.length === 0 ||
    allowedPaths.some(
      (allowedPath) =>
        !isSafeRepositoryPath(allowedPath) ||
        isProhibitedPath(allowedPath),
    )
  ) {
    throw new Error("At least one safe allowed path is required.");
  }

  const [baselineFiles, workspaceFiles] = await Promise.all([
    readWorkspaceFiles(baselineDirectory),
    readWorkspaceFiles(workspaceDirectory),
  ]);
  const candidatePaths = new Set([
    ...baselineFiles.keys(),
    ...workspaceFiles.keys(),
  ]);
  let totalBytes = 0;
  const changes: ValidatedWorkspaceChange[] = [];

  for (const changedPath of [...candidatePaths].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const baselineFile = baselineFiles.get(changedPath);
    const workspaceFile = workspaceFiles.get(changedPath);

    if (
      baselineFile &&
      workspaceFile &&
      baselineFile.mode === workspaceFile.mode &&
      baselineFile.content.equals(workspaceFile.content)
    ) {
      continue;
    }

    if (
      isProhibitedPath(changedPath) ||
      !isAllowedPath({ allowedPaths, changedPath })
    ) {
      throw new Error(`The worker changed a prohibited path: ${changedPath}`);
    }

    if (!workspaceFile) {
      changes.push({
        path: changedPath,
        status: "deleted",
      });
      continue;
    }

    const { content, mode } = workspaceFile;

    if (content.byteLength > MAX_FILE_BYTES) {
      throw new Error(`Changed file exceeds ${MAX_FILE_BYTES} bytes: ${changedPath}`);
    }

    if (content.includes(0)) {
      throw new Error(`Binary file changes are not supported: ${changedPath}`);
    }

    totalBytes += content.byteLength;

    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(
        `The worker change exceeds ${MAX_TOTAL_BYTES} total bytes.`,
      );
    }

    changes.push({
      contentBase64: content.toString("base64"),
      mode,
      path: changedPath,
      status: baselineFile ? "modified" : "added",
    });
  }

  if (changes.length === 0) {
    throw new Error("The worker completed without producing a change.");
  }

  if (changes.length > MAX_CHANGED_FILES) {
    throw new Error(
      `The worker changed more than ${MAX_CHANGED_FILES} files.`,
    );
  }

  return changes;
};
