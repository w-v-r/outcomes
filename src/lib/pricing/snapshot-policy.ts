import "server-only";

import { sha256CanonicalJson } from "@/lib/repositories/hash";

import {
  type RepositoryManifest,
  type TaskAnalysis,
  type TaskEstimate,
} from "./domain";

export const SNAPSHOT_PRICING_POLICY = {
  id: "snapshot-variable-pricing",
  marginRatio: 0.1,
  paymentFeeRatio: 0.02,
  quoteLifetimeMinutes: 30,
  minimumRiskRatio: 0.1,
  maximumRiskRatio: 0.75,
  usdToAudRate: 1.55,
  version: "3.0.0",
} as const;

export const ACCEPT_WITH_CONDITIONS_NOTICE =
  "Execution is limited to the bounded task contract and excludes ambiguous scope and oversized context.";

import {
  customerPricingEvidenceSchema,
  type CustomerPricingEvidence,
} from "@outcomes/contracts";

export {
  customerPricingEvidenceSchema,
  type CustomerPricingEvidence,
};

export type SnapshotUnderwriting = {
  analysisAllowanceUsd: number;
  commercialMinimumCents: number;
  fixedPriceCents: number;
  internalBudgetUsd: number;
  marginAllowanceCents: number;
  paymentAllowanceCents: number;
  predictedWorkerHighUsd: number;
  retryRiskAllowanceUsd: number;
  retryRiskMultiplier: number;
  verificationAllowanceUsd: number;
  workerExecutionBudgetUsd: number;
};

const roundUsd = (value: number): number => Number(value.toFixed(6));

export const deriveSnapshotPricing = ({
  analysis,
  estimate,
  manifest,
}: {
  analysis: TaskAnalysis;
  estimate: TaskEstimate;
  manifest: RepositoryManifest;
}): {
  customer: CustomerPricingEvidence;
  evidenceHash: string;
  underwriting: SnapshotUnderwriting;
} => {
  const predictedWorkerHighUsd = estimate.predicted.costUsd.high;
  const workerExecutionBudgetUsd = predictedWorkerHighUsd;
  const analysisAllowanceUsd = 0;
  const verificationAllowanceUsd = 0;
  const failureProbability = 1 - estimate.predicted.successProbability;
  const retryRiskMultiplier = Math.min(
    SNAPSHOT_PRICING_POLICY.maximumRiskRatio,
    Math.max(
      SNAPSHOT_PRICING_POLICY.minimumRiskRatio,
      failureProbability / estimate.predicted.successProbability,
    ),
  );
  const retryRiskAllowanceUsd =
    workerExecutionBudgetUsd *
    retryRiskMultiplier;
  const internalBudgetUsd =
    workerExecutionBudgetUsd +
    retryRiskAllowanceUsd;
  const costCoverageCents = Math.ceil(
    internalBudgetUsd * SNAPSHOT_PRICING_POLICY.usdToAudRate * 100,
  );
  const marginAllowanceCents = Math.ceil(
    costCoverageCents * SNAPSHOT_PRICING_POLICY.marginRatio,
  );
  const commercialMinimumCents = 0;
  const prePaymentFeeCents =
    costCoverageCents + marginAllowanceCents;
  const fixedPriceCents = Math.max(
    1,
    Math.ceil(
      prePaymentFeeCents /
        (1 - SNAPSHOT_PRICING_POLICY.paymentFeeRatio),
    ),
  );
  const paymentAllowanceCents =
    fixedPriceCents - prePaymentFeeCents;
  const lowExecutionBudgetUsd = estimate.predicted.costUsd.low;
  const lowRiskAllowanceUsd =
    lowExecutionBudgetUsd * retryRiskMultiplier;
  const lowCostCoverageCents = Math.ceil(
    (lowExecutionBudgetUsd + lowRiskAllowanceUsd) *
      SNAPSHOT_PRICING_POLICY.usdToAudRate * 100,
  );
  const lowCents = Math.min(
    fixedPriceCents,
    Math.max(
      1,
      Math.ceil(
        (lowCostCoverageCents *
          (1 + SNAPSHOT_PRICING_POLICY.marginRatio)) /
          (1 - SNAPSHOT_PRICING_POLICY.paymentFeeRatio),
      ),
    ),
  );
  const factors = [
    `Task family: ${analysis.taskFamily}.`,
    `${analysis.likelyRelevantFiles.length} repository files appear relevant; ${estimate.predicted.filesTouched.low}-${estimate.predicted.filesTouched.high} are expected to change.`,
    `Execution is estimated at ${estimate.predicted.llmCalls.low}-${estimate.predicted.llmCalls.high} LLM calls.`,
    manifest.baselineSignals.hasTests
      ? "The snapshot contains test evidence."
      : "The snapshot has no detected test suite, increasing verification uncertainty.",
    manifest.baselineSignals.isMonorepo
      ? "The repository is a monorepo, increasing coordination risk."
      : "The repository is not detected as a monorepo.",
    `The predicted success confidence is ${estimate.confidence}.`,
    "The fixed quote uses the high calibrated worker-cost estimate.",
    `Failure risk adds ${(retryRiskMultiplier * 100).toFixed(1)}%.`,
    "The quote includes a 10% target margin and a 2% payment fee.",
    ...(estimate.decision === "accept_with_conditions"
      ? [`Execution condition: ${ACCEPT_WITH_CONDITIONS_NOTICE}`]
      : []),
  ];
  const executionConditions =
    estimate.decision === "accept_with_conditions"
      ? [ACCEPT_WITH_CONDITIONS_NOTICE]
      : [];
  const customer = customerPricingEvidenceSchema.parse({
    caveat:
      "Planning estimate from a deterministic, uncalibrated policy; not a delivery guarantee.",
    confidence: estimate.confidence,
    estimator: estimate.estimator,
    estimatorDecision: estimate.decision,
    executionConditions,
    factors,
    policyVersion: `${SNAPSHOT_PRICING_POLICY.id}:${SNAPSHOT_PRICING_POLICY.version}`,
    range: {
      currency: "AUD",
      highCents: fixedPriceCents,
      lowCents,
    },
  });
  const underwriting: SnapshotUnderwriting = {
    analysisAllowanceUsd: roundUsd(analysisAllowanceUsd),
    commercialMinimumCents,
    fixedPriceCents,
    internalBudgetUsd: roundUsd(internalBudgetUsd),
    marginAllowanceCents,
    paymentAllowanceCents,
    predictedWorkerHighUsd: roundUsd(predictedWorkerHighUsd),
    retryRiskAllowanceUsd: roundUsd(retryRiskAllowanceUsd),
    retryRiskMultiplier: Number(retryRiskMultiplier.toFixed(6)),
    verificationAllowanceUsd: roundUsd(verificationAllowanceUsd),
    workerExecutionBudgetUsd: roundUsd(workerExecutionBudgetUsd),
  };

  return {
    customer,
    evidenceHash: sha256CanonicalJson({
      customer,
      policy: SNAPSHOT_PRICING_POLICY,
    }),
    underwriting,
  };
};
