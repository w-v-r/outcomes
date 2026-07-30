import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const MAX_CHANGED_FILES = 25;
const MAX_FILE_BYTES = 500_000;
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

const runGit = async ({
  args,
  gitDirectory,
  workspaceDirectory,
}: {
  args: string[];
  gitDirectory: string;
  workspaceDirectory: string;
}): Promise<string> => {
  const { stdout } = await execFileAsync(
    "git",
    [
      `--git-dir=${gitDirectory}`,
      `--work-tree=${workspaceDirectory}`,
      ...args,
    ],
    {
      encoding: "utf8",
      maxBuffer: 2_000_000,
    },
  );

  return stdout;
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

const parseStatus = (statusOutput: string): Map<string, string> => {
  const statusByPath = new Map<string, string>();
  const records = statusOutput.split("\0").filter(Boolean);

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    const changedPath = record.slice(3);

    if (status.includes("R") || status.includes("C")) {
      throw new Error("Renamed or copied files are not supported by the spike.");
    }

    if (!isSafeRepositoryPath(changedPath)) {
      throw new Error("The worker produced an unsafe repository path.");
    }

    statusByPath.set(changedPath, status);
  }

  return statusByPath;
};

const getFileMode = async ({
  changedPath,
  gitDirectory,
  status,
  workspaceDirectory,
}: {
  changedPath: string;
  gitDirectory: string;
  status: string;
  workspaceDirectory: string;
}): Promise<"100644" | "100755"> => {
  if (status !== "??") {
    const stage = await runGit({
      args: ["ls-files", "--stage", "--", changedPath],
      gitDirectory,
      workspaceDirectory,
    });
    const mode = stage.split(/\s/u, 1)[0];

    if (mode === "100644" || mode === "100755") {
      return mode;
    }

    throw new Error(
      `Unsupported Git object mode for changed file: ${changedPath}`,
    );
  }

  const fileStat = await lstat(path.join(workspaceDirectory, changedPath));

  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`Only regular files may be added: ${changedPath}`);
  }

  return (fileStat.mode & 0o111) === 0 ? "100644" : "100755";
};

export const collectValidatedWorkspaceChanges = async ({
  allowedPaths,
  baseSha,
  gitDirectory,
  workspaceDirectory,
}: {
  allowedPaths: string[];
  baseSha: string;
  gitDirectory: string;
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

  const headSha = (
    await runGit({
      args: ["rev-parse", "HEAD"],
      gitDirectory,
      workspaceDirectory,
    })
  ).trim();

  if (headSha !== baseSha) {
    throw new Error("The isolated workspace baseline SHA changed during execution.");
  }

  const baselineEntries = (
    await runGit({
      args: ["ls-files", "--stage", "-z"],
      gitDirectory,
      workspaceDirectory,
    })
  )
    .split("\0")
    .filter(Boolean);
  const unsupportedBaselineEntry = baselineEntries.find((entry) => {
    const mode = entry.slice(0, 6);
    return mode === "120000" || mode === "160000";
  });

  if (unsupportedBaselineEntry) {
    throw new Error(
      "Repositories containing symlinks or submodules are unsupported by the isolated-worker spike.",
    );
  }

  const statusOutput = await runGit({
    args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    gitDirectory,
    workspaceDirectory,
  });
  const statusByPath = parseStatus(statusOutput);

  if (statusByPath.size === 0) {
    throw new Error("The worker completed without producing a change.");
  }

  if (statusByPath.size > MAX_CHANGED_FILES) {
    throw new Error(
      `The worker changed more than ${MAX_CHANGED_FILES} files.`,
    );
  }

  let totalBytes = 0;
  const changes: ValidatedWorkspaceChange[] = [];

  for (const [changedPath, status] of [...statusByPath].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (
      isProhibitedPath(changedPath) ||
      !isAllowedPath({ allowedPaths, changedPath })
    ) {
      throw new Error(`The worker changed a prohibited path: ${changedPath}`);
    }

    if (/[ADU]/u.test(status) && status !== "??") {
      if (status.includes("U") || status === "AA" || status === "DD") {
        throw new Error(`The worker left a conflicted file: ${changedPath}`);
      }
    }

    if (status.includes("D")) {
      changes.push({
        path: changedPath,
        status: "deleted",
      });
      continue;
    }

    const content = await readFile(
      path.join(workspaceDirectory, changedPath),
    );

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
      mode: await getFileMode({
        changedPath,
        gitDirectory,
        status,
        workspaceDirectory,
      }),
      path: changedPath,
      status: status === "??" ? "added" : "modified",
    });
  }

  return changes;
};
