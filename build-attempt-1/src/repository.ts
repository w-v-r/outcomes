import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  SCHEMA_VERSION,
  repositoryManifestSchema,
  type RepositoryFile,
  type RepositoryManifest,
} from "./domain.js";

const execFileAsync = promisify(execFile);
const DEFAULT_OVERSIZED_BYTES = 128_000;
const MAX_TEXT_FILE_BYTES = 2_000_000;
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".repo-cost",
  ".turbo",
  "artifacts",
  "build",
  "coverage",
  "dist",
  "node_modules",
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

export type RepositoryInput =
  | { kind: "local"; path: string }
  | { kind: "github"; url: string; ref: string };

export interface ResolvedRepository {
  rootPath: string;
  source: RepositoryManifest["source"];
  cleanup: () => Promise<void>;
}

const runGit = async (cwd: string, args: string[]): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return null;
  }
};

export const resolveRepository = async (
  input: RepositoryInput,
  options: { isolateLocal?: boolean } = {},
): Promise<ResolvedRepository> => {
  if (input.kind === "local") {
    const rootPath = resolve(input.path);
    const rootStats = await stat(rootPath);
    if (!rootStats.isDirectory()) {
      throw new Error(`Repository path is not a directory: ${rootPath}`);
    }
    if (options.isolateLocal) {
      const checkoutPath = await mkdtemp(join(tmpdir(), "repo-cost-local-"));
      await cp(rootPath, checkoutPath, {
        recursive: true,
        filter: (sourcePath) => {
          const pathSegments = relative(rootPath, sourcePath).split(sep);
          return !pathSegments.some((segment) => EXCLUDED_DIRECTORIES.has(segment));
        },
      });
      return {
        rootPath: checkoutPath,
        source: { kind: "local", path: rootPath },
        cleanup: async () => rm(checkoutPath, { recursive: true, force: true }),
      };
    }
    return {
      rootPath,
      source: { kind: "local", path: rootPath },
      cleanup: async () => undefined,
    };
  }

  const checkoutPath = await mkdtemp(join(tmpdir(), "repo-cost-"));
  try {
    await execFileAsync("git", ["init", "--quiet", checkoutPath]);
    await execFileAsync("git", ["remote", "add", "origin", input.url], { cwd: checkoutPath });
    await execFileAsync(
      "git",
      ["fetch", "--depth", "1", "origin", input.ref],
      { cwd: checkoutPath, maxBuffer: 8 * 1024 * 1024 },
    );
    await execFileAsync(
      "git",
      ["checkout", "--quiet", "--detach", "FETCH_HEAD"],
      { cwd: checkoutPath, maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (error) {
    await rm(checkoutPath, { recursive: true, force: true });
    throw new Error(`Unable to clone ${input.url} at ${input.ref}`, { cause: error });
  }

  return {
    rootPath: checkoutPath,
    source: {
      kind: "github",
      url: input.url,
      ref: input.ref,
    },
    cleanup: async () => rm(checkoutPath, { recursive: true, force: true }),
  };
};

const isProbablyBinary = (content: Buffer): boolean => {
  const sample = content.subarray(0, Math.min(content.length, 8_192));
  return sample.includes(0);
};

const isGeneratedPath = (path: string): boolean => {
  const normalizedPath = path.toLowerCase();
  return (
    normalizedPath.includes(".min.")
    || normalizedPath.includes("/generated/")
    || normalizedPath.includes("/__generated__/")
    || normalizedPath.endsWith(".lock")
  );
};

const isTestPath = (path: string): boolean => (
  /(^|\/)(__tests__|tests?|specs?)(\/|$)/i.test(path)
  || /\.(test|spec)\.[^.]+$/i.test(path)
);

const categorizeFile = (
  path: string,
  fileName: string,
  binary: boolean,
): RepositoryFile["category"] => {
  if (binary) return "binary";
  if (MANIFEST_NAMES.has(fileName) || LOCKFILE_NAMES.has(fileName)) return "manifest";
  if (isGeneratedPath(path)) return "generated";
  if (isTestPath(path)) return "test";
  if ([".md", ".mdx", ".rst", ".txt"].includes(extname(path).toLowerCase())) return "documentation";
  if (LANGUAGE_BY_EXTENSION[extname(path).toLowerCase()]) return "source";
  return "other";
};

const collectFilePaths = async (rootPath: string, currentPath = rootPath): Promise<string[]> => {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = join(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      paths.push(...await collectFilePaths(rootPath, absolutePath));
      continue;
    }
    if (entry.isFile()) paths.push(absolutePath);
  }

  return paths;
};

const inspectFile = async (
  rootPath: string,
  absolutePath: string,
): Promise<RepositoryFile> => {
  const fileStats = await stat(absolutePath);
  const repositoryPath = relative(rootPath, absolutePath).split(sep).join("/");
  const extension = extname(repositoryPath).toLowerCase();

  if (fileStats.size > MAX_TEXT_FILE_BYTES) {
    return {
      path: repositoryPath,
      extension,
      bytes: fileStats.size,
      lines: 0,
      approximateTokens: Math.ceil(fileStats.size / 4),
      category: "binary",
    };
  }

  const content = await readFile(absolutePath);
  const binary = isProbablyBinary(content);
  const text = binary ? "" : content.toString("utf8");
  return {
    path: repositoryPath,
    extension,
    bytes: fileStats.size,
    lines: text.length === 0 ? 0 : text.split(/\r?\n/u).length,
    approximateTokens: binary ? 0 : Math.ceil(text.length / 4),
    category: categorizeFile(repositoryPath, basename(repositoryPath), binary),
  };
};

export const analyzeRepository = async (
  repository: ResolvedRepository,
  oversizedBytes = DEFAULT_OVERSIZED_BYTES,
): Promise<RepositoryManifest> => {
  const absolutePaths = await collectFilePaths(repository.rootPath);
  const files: RepositoryFile[] = [];
  for (const absolutePath of absolutePaths) {
    files.push(await inspectFile(repository.rootPath, absolutePath));
  }
  files.sort((left, right) => left.path.localeCompare(right.path));

  const languages: RepositoryManifest["languages"] = {};
  for (const file of files) {
    const language = LANGUAGE_BY_EXTENSION[file.extension] ?? "Other";
    const current = languages[language] ?? { files: 0, bytes: 0, approximateTokens: 0 };
    current.files += 1;
    current.bytes += file.bytes;
    current.approximateTokens += file.approximateTokens;
    languages[language] = current;
  }

  const commitSha = await runGit(repository.rootPath, ["rev-parse", "HEAD"]);
  const status = await runGit(repository.rootPath, ["status", "--porcelain"]);
  const manifests = files
    .filter(({ path }) => MANIFEST_NAMES.has(basename(path)))
    .map(({ path }) => path);
  const packageDirectories = new Set(
    manifests.map((path) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "."),
  );
  const total = files.reduce(
    (aggregate, file) => ({
      files: aggregate.files + 1,
      bytes: aggregate.bytes + file.bytes,
      lines: aggregate.lines + file.lines,
      approximateTokens: aggregate.approximateTokens + file.approximateTokens,
    }),
    { files: 0, bytes: 0, lines: 0, approximateTokens: 0 },
  );

  return repositoryManifestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: repository.source,
    snapshot: {
      commitSha,
      dirty: status !== null && status.length > 0,
    },
    totals: total,
    languages,
    packages: [...packageDirectories].sort(),
    manifests,
    testFiles: files.filter(({ path }) => isTestPath(path)).map(({ path }) => path),
    oversizedFiles: files
      .filter(({ bytes, category }) => bytes > oversizedBytes && category !== "binary")
      .map(({ path, bytes, approximateTokens }) => ({ path, bytes, approximateTokens })),
    baselineSignals: {
      hasTests: files.some(({ path }) => isTestPath(path)),
      hasLockfile: files.some(({ path }) => LOCKFILE_NAMES.has(basename(path))),
      isMonorepo: packageDirectories.size > 1,
      generatedFileCount: files.filter(({ category }) => category === "generated").length,
      binaryFileCount: files.filter(({ category }) => category === "binary").length,
    },
    files,
  });
};
