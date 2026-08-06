import "server-only";

import {
  PRICING_SCHEMA_VERSION,
  taskEstimateSchema,
  type ModelRate,
  type RepositoryManifest,
  type TaskAnalysis,
  type TaskEstimate,
  type TaskRequest,
} from "./domain";
import { calculateUsageCostUsd } from "./rate-card";

export const WORKER_CHARGE_CALIBRATION = {
  observedChargedCents: 13.4963,
  observedRateCardCents: 2.9888,
  sampleCount: 1,
  source: "Cursor worker charged-cost reconciliation",
} as const;

export type CostEstimatorInput = {
  analysis: TaskAnalysis;
  manifest: RepositoryManifest;
  modelRate: ModelRate;
  task: TaskRequest;
};

const FAMILY_OUTPUT_TOKENS: Record<
  TaskAnalysis["taskFamily"],
  number
> = {
  "bug-fix": 2_400,
  documentation: 1_500,
  feature: 4_000,
  investigation: 3_200,
  migration: 4_500,
  refactor: 3_500,
  test: 2_200,
  unknown: 3_800,
};

const FAMILY_LLM_CALLS: Record<TaskAnalysis["taskFamily"], number> = {
  "bug-fix": 4,
  documentation: 2,
  feature: 6,
  investigation: 5,
  migration: 7,
  refactor: 5,
  test: 3,
  unknown: 6,
};

const FAMILY_FILE_CAP: Record<TaskAnalysis["taskFamily"], number> = {
  "bug-fix": 3,
  documentation: 1,
  feature: 6,
  investigation: 5,
  migration: 8,
  refactor: 6,
  test: 4,
  unknown: 6,
};

const createRange = (
  central: number,
  lowRatio: number,
  highRatio: number,
) => ({
  central: Math.max(1, Math.round(central)),
  high: Math.max(1, Math.round(central * highRatio)),
  low: Math.max(1, Math.round(central * lowRatio)),
});

const estimateCostRange = (
  inputTokens: ReturnType<typeof createRange>,
  outputTokens: ReturnType<typeof createRange>,
  cacheReadTokens: ReturnType<typeof createRange>,
  rate: ModelRate,
) => ({
  central: calculateUsageCostUsd(
    {
      cacheReadTokens: cacheReadTokens.central,
      cacheWriteTokens: 0,
      inputTokens: inputTokens.central,
      outputTokens: outputTokens.central,
    },
    rate,
  ),
  high: calculateUsageCostUsd(
    {
      cacheReadTokens: cacheReadTokens.high,
      cacheWriteTokens: 0,
      inputTokens: inputTokens.high,
      outputTokens: outputTokens.high,
    },
    rate,
  ),
  low: calculateUsageCostUsd(
    {
      cacheReadTokens: cacheReadTokens.low,
      cacheWriteTokens: 0,
      inputTokens: inputTokens.low,
      outputTokens: outputTokens.low,
    },
    rate,
  ),
});

const calibrateCostRange = (
  costUsd: ReturnType<typeof estimateCostRange>,
) => {
  const multiplier =
    WORKER_CHARGE_CALIBRATION.observedChargedCents /
    WORKER_CHARGE_CALIBRATION.observedRateCardCents;

  return {
    central: Number((costUsd.central * multiplier).toFixed(8)),
    high: Number((costUsd.high * multiplier).toFixed(8)),
    low: Number((costUsd.low * multiplier).toFixed(8)),
  };
};

export const estimateTaskCost = async ({
  analysis,
  manifest,
  modelRate,
}: CostEstimatorInput): Promise<TaskEstimate> => {
  const likelyEditableFileCount = analysis.likelyRelevantFiles.filter(
    ({ path }) => {
      const category = manifest.files.find(
        (file) => file.path === path,
      )?.category;

      return category && !["binary", "generated", "manifest"].includes(category);
    },
  ).length;
  const filesTouchedCentral = Math.max(
    1,
    Math.min(
      FAMILY_FILE_CAP[analysis.taskFamily],
      likelyEditableFileCount || 1,
    ),
  );
  const filesTouched = {
    central: filesTouchedCentral,
    high: Math.min(20, Math.max(filesTouchedCentral, filesTouchedCentral * 2)),
    low: Math.max(1, Math.ceil(filesTouchedCentral * 0.5)),
  };
  const llmCallsCentral =
    FAMILY_LLM_CALLS[analysis.taskFamily] +
    Math.max(0, Math.ceil(filesTouchedCentral / 3) - 1) +
    (analysis.clarityScore < 0.55 ? 1 : 0);
  const contextFileLimit = Math.max(
    filesTouched.high,
    Math.min(4, filesTouchedCentral + 2),
  );
  const relevantContextTokens = analysis.likelyRelevantFiles
    .slice(0, contextFileLimit)
    .reduce(
      (total, file) =>
        total + Math.min(file.approximateTokens, 16_000),
      0,
    );
  const repositoryInspectionTokens = Math.min(
    relevantContextTokens *
      (1 + Math.max(0, llmCallsCentral - 1) * 0.35),
    120_000,
  );
  const structuralOverhead =
    llmCallsCentral * 3_500 +
    manifest.packages.length * 500 +
    manifest.oversizedFiles.length * 500 +
    (manifest.baselineSignals.isMonorepo ? 2_500 : 0);
  const inputCentral =
    analysis.requestTokens * llmCallsCentral +
    repositoryInspectionTokens +
    structuralOverhead;
  const outputCentral = FAMILY_OUTPUT_TOKENS[analysis.taskFamily];
  const cacheReadCentral = inputCentral * 0.6;
  const uncertaintyMultiplier =
    1 +
    (1 - analysis.clarityScore) * 0.6 +
    (1 - analysis.boundednessScore) * 0.8 +
    (analysis.taskFamily === "unknown" ? 0.35 : 0) +
    (manifest.baselineSignals.isMonorepo ? 0.2 : 0);
  const llmCalls = createRange(
    llmCallsCentral,
    0.65,
    1.35 * uncertaintyMultiplier,
  );
  const inputTokens = createRange(
    inputCentral,
    0.55,
    1.35 * uncertaintyMultiplier,
  );
  const outputTokens = createRange(
    outputCentral,
    0.5,
    1.6 * uncertaintyMultiplier,
  );
  const cacheReadTokens = createRange(
    cacheReadCentral,
    0.25,
    2 * uncertaintyMultiplier,
  );
  const costUsd = calibrateCostRange(
    estimateCostRange(
      inputTokens,
      outputTokens,
      cacheReadTokens,
      modelRate,
    ),
  );
  const successProbability = Math.max(
    0.05,
    Math.min(
      0.95,
      0.2 +
        analysis.clarityScore * 0.2 +
        analysis.boundednessScore * 0.2 +
        analysis.verifiabilityScore * 0.3 +
        (manifest.baselineSignals.hasTests ? 0.1 : 0) -
        (analysis.taskFamily === "unknown" ? 0.1 : 0),
    ),
  );
  let decision: TaskEstimate["decision"] = "accept";
  const reasons: string[] = [];

  if (
    analysis.boundednessScore < 0.35 ||
    analysis.verifiabilityScore < 0.2
  ) {
    decision = "decompose";
    reasons.push("task is insufficiently bounded or verifiable");
  } else if (successProbability < 0.45) {
    decision = "decline";
    reasons.push("verified-success probability is below policy");
  } else if (
    analysis.clarityScore < 0.55 ||
    manifest.oversizedFiles.length > 0
  ) {
    decision = "accept_with_conditions";
    reasons.push("quote excludes ambiguous scope and oversized context");
  } else {
    reasons.push("task passes boundedness and verifiability policy");
  }

  const confidence =
    analysis.clarityScore > 0.75 &&
    analysis.verifiabilityScore > 0.7
      ? "medium"
      : "low";
  const highTotalTokens =
    inputTokens.high + outputTokens.high + cacheReadTokens.high;
  const runtimeCentral = Math.max(
    60,
    Math.round(llmCalls.central * 35 + highTotalTokens / 1_000),
  );

  return taskEstimateSchema.parse({
    assumptions: [
      "Execution cost is calibrated against observed Cursor worker charges.",
      "Relevant files may be reread across multiple agent turns.",
      "The charged-cost calibration is conservative while the sample is small.",
      "Token and cost limits are soft because usage arrives after turns.",
    ],
    confidence,
    decision,
    estimator: {
      id: "deterministic-repository-heuristic",
      version: "1.3.0",
    },
    executionAllowance: {
      maxToolCalls: Math.min(
        100,
        Math.max(
          10,
          llmCalls.high * 4 + filesTouched.high * 2,
        ),
      ),
      softCostLimitUsd: Math.max(
        0.01,
        Number((costUsd.high * 1.2).toFixed(4)),
      ),
      softTokenLimit: Math.max(
        1_000,
        Math.round(highTotalTokens * 1.2),
      ),
      wallClockSeconds: Math.min(
        1_800,
        Math.max(120, runtimeCentral * 2),
      ),
    },
    generatedAt: new Date().toISOString(),
    predicted: {
      cacheReadTokens,
      costUsd,
      filesTouched,
      inputTokens,
      llmCalls,
      outputTokens,
      runtimeSeconds: createRange(runtimeCentral, 0.5, 2),
      successProbability,
    },
    reasons: [
      ...reasons,
      `estimated files touched: ${filesTouched.low}-${filesTouched.high}`,
      `estimated LLM calls: ${llmCalls.low}-${llmCalls.high}`,
      ...analysis.signals,
    ],
    schemaVersion: PRICING_SCHEMA_VERSION,
  });
};
