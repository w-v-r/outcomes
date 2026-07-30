import "server-only";

import { lstat, readFile, readdir } from "node:fs/promises";
import {
  basename,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  PRICING_SCHEMA_VERSION,
  repositoryManifestSchema,
  type RepositoryFile,
  type RepositoryManifest,
} from "@/lib/pricing/domain";
import { parseGitHubRepository } from "@/lib/repositories/github";
import { compareCodeUnits } from "@/lib/repositories/hash";

export const REPOSITORY_SCANNER_ID = "outcomes-read-only-filesystem";
export const REPOSITORY_SCANNER_VERSION = "1.0.0";

export const DEFAULT_REPOSITORY_SCAN_LIMITS = {
  maxFileCount: 20_000,
  maxTextFileBytes: 2_000_000,
  maxTotalBytes: 100_000_000,
  oversizedFileBytes: 128_000,
} as const;

export type RepositoryScanLimits = {
  maxFileCount: number;
  maxTextFileBytes: number;
  maxTotalBytes: number;
  oversizedFileBytes: number;
};

type CollectedFile = {
  absolutePath: string;
  bytes: number;
  repositoryPath: string;
};

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".repo-cost",
  ".turbo",
  "artifacts",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);
const MANIFEST_NAMES = new Set([
  "Cargo.toml",
  "Gemfile",
  "go.mod",
  "package.json",
  "pom.xml",
  "pyproject.toml",
  "requirements.txt",
]);
const LOCKFILE_NAMES = new Set([
  "Cargo.lock",
  "Gemfile.lock",
  "go.sum",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "uv.lock",
  "yarn.lock",
]);
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".c": "C",
  ".cpp": "C++",
  ".cs": "C#",
  ".css": "CSS",
  ".go": "Go",
  ".html": "HTML",
  ".java": "Java",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".json": "JSON",
  ".kt": "Kotlin",
  ".md": "Markdown",
  ".php": "PHP",
  ".py": "Python",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".scss": "SCSS",
  ".sh": "Shell",
  ".sql": "SQL",
  ".svelte": "Svelte",
  ".swift": "Swift",
  ".toml": "TOML",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".vue": "Vue",
  ".yaml": "YAML",
  ".yml": "YAML",
};

const isProbablyBinary = (content: Buffer): boolean => {
  const sample = content.subarray(0, Math.min(content.length, 8_192));
  return sample.includes(0);
};

const isGeneratedPath = (repositoryPath: string): boolean => {
  const normalizedPath = repositoryPath.toLowerCase();

  return (
    normalizedPath.includes(".min.") ||
    normalizedPath.includes("/generated/") ||
    normalizedPath.includes("/__generated__/") ||
    normalizedPath.endsWith(".lock")
  );
};

const isTestPath = (repositoryPath: string): boolean =>
  /(^|\/)(__tests__|tests?|specs?)(\/|$)/iu.test(repositoryPath) ||
  /\.(test|spec)\.[^.]+$/iu.test(repositoryPath);

const categorizeFile = ({
  binary,
  fileName,
  repositoryPath,
}: {
  binary: boolean;
  fileName: string;
  repositoryPath: string;
}): RepositoryFile["category"] => {
  if (binary) {
    return "binary";
  }

  if (MANIFEST_NAMES.has(fileName) || LOCKFILE_NAMES.has(fileName)) {
    return "manifest";
  }

  if (isGeneratedPath(repositoryPath)) {
    return "generated";
  }

  if (isTestPath(repositoryPath)) {
    return "test";
  }

  if (
    [".md", ".mdx", ".rst", ".txt"].includes(
      extname(repositoryPath).toLowerCase(),
    )
  ) {
    return "documentation";
  }

  if (LANGUAGE_BY_EXTENSION[extname(repositoryPath).toLowerCase()]) {
    return "source";
  }

  return "other";
};

const assertScanLimits = (limits: RepositoryScanLimits): void => {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Repository scan limit ${name} must be a positive integer.`);
    }
  }
};

const collectFiles = async ({
  currentPath,
  files,
  limits,
  rootPath,
  totalBytes,
}: {
  currentPath: string;
  files: CollectedFile[];
  limits: RepositoryScanLimits;
  rootPath: string;
  totalBytes: { value: number };
}): Promise<void> => {
  const entries = await readdir(currentPath, { withFileTypes: true });
  entries.sort((left, right) => compareCodeUnits(left.name, right.name));

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const absolutePath = join(currentPath, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      await collectFiles({
        currentPath: absolutePath,
        files,
        limits,
        rootPath,
        totalBytes,
      });
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileStats = await lstat(absolutePath);

    if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
      continue;
    }

    if (files.length >= limits.maxFileCount) {
      throw new Error(
        `Repository exceeds the ${limits.maxFileCount} file scan limit.`,
      );
    }

    totalBytes.value += fileStats.size;

    if (totalBytes.value > limits.maxTotalBytes) {
      throw new Error(
        `Repository exceeds the ${limits.maxTotalBytes} byte scan limit.`,
      );
    }

    files.push({
      absolutePath,
      bytes: fileStats.size,
      repositoryPath: relative(rootPath, absolutePath)
        .split(sep)
        .join("/"),
    });
  }
};

const inspectFile = async ({
  file,
  maxTextFileBytes,
}: {
  file: CollectedFile;
  maxTextFileBytes: number;
}): Promise<RepositoryFile> => {
  const extension = extname(file.repositoryPath).toLowerCase();

  if (file.bytes > maxTextFileBytes) {
    return {
      approximateTokens: Math.ceil(file.bytes / 4),
      bytes: file.bytes,
      category: "binary",
      extension,
      lines: 0,
      path: file.repositoryPath,
    };
  }

  const content = await readFile(file.absolutePath);

  if (content.byteLength !== file.bytes) {
    throw new Error(
      `Repository file changed while scanning: ${file.repositoryPath}`,
    );
  }

  const binary = isProbablyBinary(content);
  const text = binary ? "" : content.toString("utf8");

  return {
    approximateTokens: binary ? 0 : Math.ceil(text.length / 4),
    bytes: file.bytes,
    category: categorizeFile({
      binary,
      fileName: basename(file.repositoryPath),
      repositoryPath: file.repositoryPath,
    }),
    extension,
    lines: text.length === 0 ? 0 : text.split(/\r?\n/u).length,
    path: file.repositoryPath,
  };
};

export const scanRepository = async ({
  expectedCommitSha,
  limits: limitOverrides,
  rootPath: rootPathValue,
  source,
}: {
  expectedCommitSha: string;
  limits?: Partial<RepositoryScanLimits>;
  rootPath: string;
  source: RepositoryManifest["source"];
}): Promise<RepositoryManifest> => {
  const repository = parseGitHubRepository(source.url);
  const rootPath = resolve(rootPathValue);
  const rootStats = await lstat(rootPath);
  const limits = {
    ...DEFAULT_REPOSITORY_SCAN_LIMITS,
    ...limitOverrides,
  };

  assertScanLimits(limits);

  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("Repository scan root must be a real directory.");
  }

  if (
    !repository ||
    repository.url !== source.url ||
    !/^[0-9a-f]{40}$/u.test(expectedCommitSha) ||
    source.ref !== expectedCommitSha
  ) {
    throw new Error(
      "Repository scan requires canonical GitHub source metadata at an exact lowercase commit SHA.",
    );
  }

  const collectedFiles: CollectedFile[] = [];
  await collectFiles({
    currentPath: rootPath,
    files: collectedFiles,
    limits,
    rootPath,
    totalBytes: { value: 0 },
  });
  collectedFiles.sort((left, right) =>
    compareCodeUnits(left.repositoryPath, right.repositoryPath),
  );

  const files: RepositoryFile[] = [];

  for (const file of collectedFiles) {
    files.push(
      await inspectFile({
        file,
        maxTextFileBytes: limits.maxTextFileBytes,
      }),
    );
  }

  const languages: RepositoryManifest["languages"] = {};

  for (const file of files) {
    const language = LANGUAGE_BY_EXTENSION[file.extension] ?? "Other";
    const current = languages[language] ?? {
      approximateTokens: 0,
      bytes: 0,
      files: 0,
    };
    current.approximateTokens += file.approximateTokens;
    current.bytes += file.bytes;
    current.files += 1;
    languages[language] = current;
  }

  const manifests = files
    .filter(({ path }) => MANIFEST_NAMES.has(basename(path)))
    .map(({ path }) => path);
  const packageDirectories = new Set(
    manifests.map((path) =>
      path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".",
    ),
  );
  const totals = files.reduce(
    (aggregate, file) => ({
      approximateTokens:
        aggregate.approximateTokens + file.approximateTokens,
      bytes: aggregate.bytes + file.bytes,
      files: aggregate.files + 1,
      lines: aggregate.lines + file.lines,
    }),
    { approximateTokens: 0, bytes: 0, files: 0, lines: 0 },
  );

  return repositoryManifestSchema.parse({
    baselineSignals: {
      binaryFileCount: files.filter(({ category }) => category === "binary")
        .length,
      generatedFileCount: files.filter(
        ({ category }) => category === "generated",
      ).length,
      hasLockfile: files.some(({ path }) =>
        LOCKFILE_NAMES.has(basename(path)),
      ),
      hasTests: files.some(({ path }) => isTestPath(path)),
      isMonorepo: packageDirectories.size > 1,
    },
    files,
    languages,
    manifests,
    oversizedFiles: files
      .filter(
        ({ bytes, category }) =>
          bytes > limits.oversizedFileBytes && category !== "binary",
      )
      .map(({ approximateTokens, bytes, path }) => ({
        approximateTokens,
        bytes,
        path,
      })),
    packages: [...packageDirectories].sort(compareCodeUnits),
    schemaVersion: PRICING_SCHEMA_VERSION,
    snapshot: {
      commitSha: expectedCommitSha,
      dirty: false,
    },
    source: {
      kind: "github",
      ref: expectedCommitSha,
      url: repository.url,
    },
    testFiles: files
      .filter(({ path }) => isTestPath(path))
      .map(({ path }) => path),
    totals,
  });
};
