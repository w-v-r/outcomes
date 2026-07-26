import "server-only";

import {
  taskAnalysisSchema,
  taskRequestSchema,
  type RepositoryFile,
  type RepositoryManifest,
  type TaskAnalysis,
  type TaskRequest,
} from "./domain";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "make",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "without",
  "with",
]);

const FAMILY_PATTERNS: Array<[TaskAnalysis["taskFamily"], RegExp]> = [
  ["bug-fix", /\b(bug|broken|error|fail(?:ing|ed)?|fix|regression)\b/iu],
  ["test", /\b(coverage|spec|test)\b/iu],
  ["refactor", /\b(cleanup|refactor|reorganize|simplify)\b/iu],
  ["migration", /\b(migrate|migration|upgrade)\b/iu],
  ["documentation", /\b(document|documentation|readme)\b/iu],
  ["investigation", /\b(diagnose|investigate|profile|root cause)\b/iu],
  ["feature", /\b(add|build|create|feature|implement|support)\b/iu],
];

const OPEN_ENDED_PATTERNS = [
  /\b(anything|everything|improve|modernize|optimize|somehow)\b/iu,
  /\bbest practices?\b/iu,
  /\bmake it better\b/iu,
];

const GENERIC_PATH_TERMS = new Set([
  "docs",
  "fixtures",
  "lib",
  "sample",
  "src",
  "test",
  "tests",
]);

const extractKeywords = (request: TaskRequest): string[] => {
  const text = [
    request.description,
    ...request.acceptanceCriteria,
    ...request.prohibitedChanges,
  ].join(" ");

  return [
    ...new Set(
      text
        .toLowerCase()
        .match(/[a-z][a-z0-9_-]{2,}/gu)
        ?.filter((word) => !STOP_WORDS.has(word)) ?? [],
    ),
  ].slice(0, 40);
};

const detectTaskFamily = (
  description: string,
): TaskAnalysis["taskFamily"] => {
  for (const [family, pattern] of FAMILY_PATTERNS) {
    if (pattern.test(description)) {
      return family;
    }
  }

  return "unknown";
};

const scoreFile = (
  file: RepositoryFile,
  keywords: string[],
  explicitPaths: string[],
  taskFamily: TaskAnalysis["taskFamily"],
) => {
  const path = file.path.toLowerCase();
  const pathTerms = new Set(path.split(/[/.]/u));
  const reasons: string[] = [];
  let score = 0;

  for (const explicitPath of explicitPaths) {
    if (path !== explicitPath && !path.endsWith(`/${explicitPath}`)) {
      continue;
    }

    score += 20;
    reasons.push("explicitly named in task");
  }

  for (const keyword of keywords) {
    if (!pathTerms.has(keyword)) {
      continue;
    }

    score += GENERIC_PATH_TERMS.has(keyword) ? 0.25 : 2;
    reasons.push(`path matches "${keyword}"`);
  }

  if (file.category === "manifest") {
    score += 0.75;
    reasons.push("execution/dependency manifest");
  }

  if (
    ["test", "bug-fix"].includes(taskFamily) &&
    file.category === "test"
  ) {
    score += 1.5;
    reasons.push("task likely requires test evidence");
  }

  return { reasons, score };
};

export const analyzeTask = (
  rawTask: TaskRequest,
  manifest: RepositoryManifest,
): TaskAnalysis => {
  const task = taskRequestSchema.parse(rawTask);
  const taskFamily = detectTaskFamily(task.description);
  const keywords = extractKeywords(task);
  const explicitPaths =
    [
      task.description,
      ...task.acceptanceCriteria,
      ...task.prohibitedChanges,
    ]
      .join(" ")
      .match(/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+/gu)
      ?.map((path) =>
        path.replace(/[.,;:)]+$/u, "").toLowerCase(),
      ) ?? [];
  const openEndedSignalCount = OPEN_ENDED_PATTERNS.filter((pattern) =>
    pattern.test(task.description),
  ).length;

  const scoredFiles = manifest.files
    .filter(({ category }) => !["binary", "generated"].includes(category))
    .map((file) => ({
      file,
      ...scoreFile(file, keywords, explicitPaths, taskFamily),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.file.path.localeCompare(right.file.path),
    );
  const fallbackFiles = manifest.files
    .filter(({ category }) =>
      ["source", "test", "manifest"].includes(category),
    )
    .sort(
      (left, right) =>
        left.approximateTokens - right.approximateTokens,
    )
    .slice(0, 8)
    .map((file) => ({
      file,
      reasons: ["fallback sample; no stronger path match"],
      score: 0.25,
    }));
  const highSignalFiles = scoredFiles.filter(({ score }) => score >= 3);
  const selectedFiles = (
    highSignalFiles.length > 0
      ? highSignalFiles
      : scoredFiles.length > 0
        ? scoredFiles.slice(0, 8)
        : fallbackFiles
  ).slice(0, 20);
  const relevantWorkingSetTokens = selectedFiles.reduce(
    (total, { file }) => total + file.approximateTokens,
    0,
  );
  const requestTokens = Math.ceil(
    [
      task.description,
      ...task.acceptanceCriteria,
      ...task.prohibitedChanges,
    ].join(" ").length / 4,
  );
  const clarityScore = Math.min(
    1,
    0.25 +
      Math.min(task.description.length / 400, 0.35) +
      Math.min(task.acceptanceCriteria.length * 0.12, 0.3) +
      Math.min(task.prohibitedChanges.length * 0.05, 0.1),
  );
  const boundednessScore = Math.max(
    0,
    Math.min(
      1,
      0.65 +
        task.prohibitedChanges.length * 0.08 -
        openEndedSignalCount * 0.3,
    ),
  );
  const verifiabilityScore = Math.min(
    1,
    0.55 +
      Math.min(task.acceptanceCriteria.length * 0.15, 0.3) +
      (manifest.baselineSignals.hasTests ? 0.15 : 0),
  );
  const signals = [
    `task family: ${taskFamily}`,
    `${selectedFiles.length} likely relevant files`,
    `estimated relevant working set: ${relevantWorkingSetTokens} tokens`,
    "trusted verifier is fixed by repository policy",
  ];

  if (openEndedSignalCount > 0) {
    signals.push("request contains open-ended language");
  }

  return taskAnalysisSchema.parse({
    boundednessScore,
    clarityScore,
    likelyRelevantFiles: selectedFiles.map(
      ({ file, reasons, score }) => ({
        approximateTokens: file.approximateTokens,
        path: file.path,
        reasons,
        score,
      }),
    ),
    relevantWorkingSetTokens,
    requestTokens,
    signals,
    taskFamily,
    verifiabilityScore,
  });
};
