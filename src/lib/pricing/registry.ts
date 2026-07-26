import "server-only";

import {
  repositoryManifestSchema,
  type RepositoryManifest,
  type TaskContract,
} from "./domain";

export const FIXTURE_REPOSITORY = {
  baselineSha: "4aff18a256039f727b54d3cc48b65e8e8eab7bb7",
  defaultBranch: "main",
  fullName: "w-v-r/agent-cost-benchmark-fixture",
  url: "https://github.com/w-v-r/agent-cost-benchmark-fixture",
  verifierWorkflow: "outcomes-verify.yml",
} as const;

export const ZERO_DIVISION_TASK_CONTRACT: TaskContract = {
  acceptanceCriteria: [
    "The existing zero-divisor test passes.",
    "Existing add and non-zero divide behavior remains unchanged.",
  ],
  description:
    "Fix src/calculator.js so divide throws an Error when the divisor is zero.",
  prohibitedChanges: [
    "Do not modify tests.",
    "Do not add dependencies.",
    "Do not change the exported function names.",
  ],
};

export const FIXTURE_MANIFEST: RepositoryManifest =
  repositoryManifestSchema.parse({
    baselineSignals: {
      binaryFileCount: 0,
      generatedFileCount: 0,
      hasLockfile: false,
      hasTests: true,
      isMonorepo: false,
    },
    files: [
      {
        approximateTokens: 72,
        bytes: 286,
        category: "source",
        extension: ".js",
        lines: 6,
        path: "src/calculator.js",
      },
      {
        approximateTokens: 118,
        bytes: 470,
        category: "test",
        extension: ".js",
        lines: 15,
        path: "test/calculator.test.js",
      },
      {
        approximateTokens: 49,
        bytes: 194,
        category: "manifest",
        extension: ".json",
        lines: 9,
        path: "package.json",
      },
      {
        approximateTokens: 1_360,
        bytes: 5_440,
        category: "documentation",
        extension: ".txt",
        lines: 27,
        path: "docs/large-context.txt",
      },
    ],
    languages: {
      JavaScript: {
        approximateTokens: 190,
        bytes: 756,
        files: 2,
      },
    },
    manifests: ["package.json"],
    oversizedFiles: [
      {
        approximateTokens: 1_360,
        bytes: 5_440,
        path: "docs/large-context.txt",
      },
    ],
    packages: [],
    schemaVersion: 1,
    snapshot: {
      commitSha: FIXTURE_REPOSITORY.baselineSha,
      dirty: false,
    },
    source: {
      kind: "github",
      ref: FIXTURE_REPOSITORY.defaultBranch,
      url: FIXTURE_REPOSITORY.url,
    },
    testFiles: ["test/calculator.test.js"],
    totals: {
      approximateTokens: 1_599,
      bytes: 6_390,
      files: 4,
      lines: 57,
    },
  });

export const normalizeGitHubRepositoryUrl = (value: string): string | null => {
  const trimmedValue = value.trim().replace(/\.git$/u, "");
  const sshMatch = trimmedValue.match(
    /^git@github\.com:([a-z0-9_.-]+\/[a-z0-9_.-]+)$/iu,
  );

  if (sshMatch?.[1]) {
    return `https://github.com/${sshMatch[1].toLowerCase()}`;
  }

  try {
    const url = new URL(trimmedValue);

    if (url.hostname.toLowerCase() !== "github.com") {
      return null;
    }

    const pathParts = url.pathname
      .split("/")
      .filter(Boolean)
      .slice(0, 2);

    if (pathParts.length !== 2) {
      return null;
    }

    return `https://github.com/${pathParts.join("/").toLowerCase()}`;
  } catch {
    return null;
  }
};
