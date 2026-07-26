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

export const estimateTaskCost = async ({
  analysis,
  manifest,
  modelRate,
}: CostEstimatorInput): Promise<TaskEstimate> => {
  const repositoryInspectionTokens = Math.min(
    analysis.relevantWorkingSetTokens * 2.5,
    120_000,
  );
  const structuralOverhead =
    4_000 +
    manifest.packages.length * 1_000 +
    manifest.oversizedFiles.length * 750 +
    (manifest.baselineSignals.isMonorepo ? 5_000 : 0);
  const inputCentral =
    analysis.requestTokens * 3 +
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
  const inputTokens = createRange(
    inputCentral,
    0.45,
    1.8 * uncertaintyMultiplier,
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
  const costUsd = estimateCostRange(
    inputTokens,
    outputTokens,
    cacheReadTokens,
    modelRate,
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
    Math.round(highTotalTokens / 500),
  );

  return taskEstimateSchema.parse({
    assumptions: [
      "No production-calibrated historical model is available.",
      "Relevant files may be reread across multiple agent turns.",
      "Configured rates represent model usage, not subscription accounting.",
      "Token and cost limits are soft because usage arrives after turns.",
    ],
    confidence,
    decision,
    estimator: {
      id: "deterministic-repository-heuristic",
      version: "1.0.0",
    },
    executionAllowance: {
      maxToolCalls: Math.min(
        100,
        Math.max(
          10,
          Math.ceil(analysis.likelyRelevantFiles.length * 2.5),
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
      inputTokens,
      outputTokens,
      runtimeSeconds: createRange(runtimeCentral, 0.5, 2),
      successProbability,
    },
    reasons: [...reasons, ...analysis.signals],
    schemaVersion: PRICING_SCHEMA_VERSION,
  });
};
