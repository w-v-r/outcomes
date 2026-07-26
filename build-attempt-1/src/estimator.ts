import {
  SCHEMA_VERSION,
  taskEstimateSchema,
  type ModelRate,
  type RepositoryManifest,
  type TaskAnalysis,
  type TaskEstimate,
  type TaskRequest,
} from "./domain.js";
import { calculateUsageCostUsd } from "./rate-card.js";

export interface HistoricalCostEvidence {
  sampleCount: number;
  source: string;
  medianInputTokens?: number;
  medianOutputTokens?: number;
  medianCacheReadTokens?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxCacheReadTokens?: number;
  maxTotalTokens?: number;
  maxCostUsd?: number;
  maxToolCalls?: number;
  verifiedSuccessRate?: number;
}

export interface CostEstimatorInput {
  task: TaskRequest;
  manifest: RepositoryManifest;
  analysis: TaskAnalysis;
  modelRate: ModelRate;
  historicalEvidence?: HistoricalCostEvidence;
}

export interface CostEstimator {
  readonly id: string;
  readonly version: string;
  estimate(input: CostEstimatorInput): Promise<TaskEstimate>;
}

const FAMILY_OUTPUT_TOKENS: Record<TaskAnalysis["taskFamily"], number> = {
  "bug-fix": 2_400,
  "documentation": 1_500,
  "feature": 4_000,
  "investigation": 3_200,
  "migration": 4_500,
  "refactor": 3_500,
  "test": 2_200,
  "unknown": 3_800,
};

const createRange = (central: number, lowRatio: number, highRatio: number) => ({
  low: Math.max(1, Math.round(central * lowRatio)),
  central: Math.max(1, Math.round(central)),
  high: Math.max(1, Math.round(central * highRatio)),
});

const applyObservedHighFloor = (
  range: ReturnType<typeof createRange>,
  observedMaximum?: number,
) => ({
  ...range,
  high: Math.max(range.high, Math.ceil((observedMaximum ?? 0) * 1.15)),
});

const estimateCostRange = (
  inputTokens: ReturnType<typeof createRange>,
  outputTokens: ReturnType<typeof createRange>,
  cacheReadTokens: ReturnType<typeof createRange>,
  rate: ModelRate,
) => ({
  low: calculateUsageCostUsd({
    inputTokens: inputTokens.low,
    outputTokens: outputTokens.low,
    cacheReadTokens: cacheReadTokens.low,
    cacheWriteTokens: 0,
  }, rate),
  central: calculateUsageCostUsd({
    inputTokens: inputTokens.central,
    outputTokens: outputTokens.central,
    cacheReadTokens: cacheReadTokens.central,
    cacheWriteTokens: 0,
  }, rate),
  high: calculateUsageCostUsd({
    inputTokens: inputTokens.high,
    outputTokens: outputTokens.high,
    cacheReadTokens: cacheReadTokens.high,
    cacheWriteTokens: 0,
  }, rate),
});

export class HeuristicCostEstimator implements CostEstimator {
  readonly id = "deterministic-repository-heuristic";
  readonly version = "1.0.0";

  async estimate(input: CostEstimatorInput): Promise<TaskEstimate> {
    const { analysis, historicalEvidence, manifest, modelRate, task } = input;
    const repositoryInspectionTokens = Math.min(
      analysis.relevantWorkingSetTokens * 2.5,
      120_000,
    );
    const structuralOverhead = (
      4_000
      + manifest.packages.length * 1_000
      + manifest.oversizedFiles.length * 750
      + (manifest.baselineSignals.isMonorepo ? 5_000 : 0)
    );
    const heuristicInputCentral = analysis.requestTokens * 3
      + repositoryInspectionTokens
      + structuralOverhead;
    const heuristicOutputCentral = FAMILY_OUTPUT_TOKENS[analysis.taskFamily];

    const historyWeight = historicalEvidence && historicalEvidence.sampleCount >= 1
      ? Math.min(0.5, 0.15 + historicalEvidence.sampleCount / 100)
      : 0;
    const inputCentral = historicalEvidence?.medianInputTokens !== undefined
      ? heuristicInputCentral * (1 - historyWeight) + historicalEvidence.medianInputTokens * historyWeight
      : heuristicInputCentral;
    const outputCentral = historicalEvidence?.medianOutputTokens !== undefined
      ? heuristicOutputCentral * (1 - historyWeight) + historicalEvidence.medianOutputTokens * historyWeight
      : heuristicOutputCentral;
    const heuristicCacheReadCentral = heuristicInputCentral * 0.6;
    const cacheReadCentral = historicalEvidence?.medianCacheReadTokens !== undefined
      ? heuristicCacheReadCentral * (1 - historyWeight)
        + historicalEvidence.medianCacheReadTokens * historyWeight
      : heuristicCacheReadCentral;

    const uncertaintyMultiplier = (
      1
      + (1 - analysis.clarityScore) * 0.6
      + (1 - analysis.boundednessScore) * 0.8
      + (analysis.taskFamily === "unknown" ? 0.35 : 0)
      + (manifest.baselineSignals.isMonorepo ? 0.2 : 0)
    );
    const inputTokens = applyObservedHighFloor(
      createRange(inputCentral, 0.45, 1.8 * uncertaintyMultiplier),
      historicalEvidence?.maxInputTokens,
    );
    const outputTokens = applyObservedHighFloor(
      createRange(outputCentral, 0.5, 1.6 * uncertaintyMultiplier),
      historicalEvidence?.maxOutputTokens,
    );
    const cacheReadTokens = applyObservedHighFloor(
      createRange(cacheReadCentral, 0.25, 2 * uncertaintyMultiplier),
      historicalEvidence?.maxCacheReadTokens,
    );
    const costUsd = estimateCostRange(inputTokens, outputTokens, cacheReadTokens, modelRate);

    const heuristicSuccessProbability = Math.max(
      0.05,
      Math.min(
        0.95,
        0.2
          + analysis.clarityScore * 0.2
          + analysis.boundednessScore * 0.2
          + analysis.verifiabilityScore * 0.3
          + (manifest.baselineSignals.hasTests ? 0.1 : 0)
          - (analysis.taskFamily === "unknown" ? 0.1 : 0),
      ),
    );
    const successProbability = historicalEvidence?.verifiedSuccessRate !== undefined
      ? heuristicSuccessProbability * (1 - historyWeight)
        + historicalEvidence.verifiedSuccessRate * historyWeight
      : heuristicSuccessProbability;

    let decision: TaskEstimate["decision"] = "accept";
    const reasons: string[] = [];
    if (analysis.boundednessScore < 0.35 || analysis.verifiabilityScore < 0.2) {
      decision = "decompose";
      reasons.push("task is insufficiently bounded or verifiable for a guaranteed outcome");
    } else if (successProbability < 0.45) {
      decision = "decline";
      reasons.push("estimated verified-success probability is below the spike policy threshold");
    } else if (analysis.clarityScore < 0.55 || manifest.oversizedFiles.length > 0) {
      decision = "accept_with_conditions";
      reasons.push("quote should exclude ambiguous scope or oversized context");
    } else {
      reasons.push("task passes the initial boundedness and verifiability policy");
    }

    const confidence: TaskEstimate["confidence"] = historicalEvidence && historicalEvidence.sampleCount >= 20
      ? "medium"
      : analysis.clarityScore > 0.75 && analysis.verifiabilityScore > 0.7
        ? "medium"
        : "low";
    const highTotalTokens = inputTokens.high + outputTokens.high + cacheReadTokens.high;
    const runtimeCentral = Math.max(60, Math.round(highTotalTokens / 500));
    const observedCostFloor = (historicalEvidence?.maxCostUsd ?? 0) * 1.25;
    const softCostLimitUsd = Math.max(
      0.01,
      Number((Math.max(costUsd.high * 1.2, observedCostFloor)).toFixed(4)),
    );
    const observedTokenFloor = (historicalEvidence?.maxTotalTokens ?? 0) * 1.25;

    return taskEstimateSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      estimator: { id: this.id, version: this.version },
      generatedAt: new Date().toISOString(),
      decision,
      confidence,
      predicted: {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        costUsd,
        runtimeSeconds: createRange(runtimeCentral, 0.5, 2),
        successProbability,
      },
      executionAllowance: {
        softTokenLimit: Math.max(
          1_000,
          Math.round(highTotalTokens * 1.2),
          Math.round(observedTokenFloor),
        ),
        softCostLimitUsd,
        wallClockSeconds: Math.min(1_800, Math.max(120, runtimeCentral * 2)),
        maxToolCalls: Math.min(100, Math.max(
          10,
          Math.ceil(analysis.likelyRelevantFiles.length * 2.5),
          Math.ceil((historicalEvidence?.maxToolCalls ?? 0) * 1.25),
        )),
      },
      assumptions: [
        "No production-calibrated historical model is available.",
        "Relevant files may be reread across multiple agent turns.",
        "Configured token rates represent on-demand model usage, not subscription accounting.",
        "Token and cost limits are soft because usage is reported after each turn.",
        "Verification and payment-processing costs are outside this execution-only estimate.",
      ],
      reasons: [...reasons, ...analysis.signals],
      ...(historicalEvidence ? {
        historicalEvidence: {
          sampleCount: historicalEvidence.sampleCount,
          source: historicalEvidence.source,
        },
      } : {}),
    });
  }
}
