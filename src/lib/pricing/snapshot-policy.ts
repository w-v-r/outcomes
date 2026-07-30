import "server-only";

import { sha256CanonicalJson } from "@/lib/repositories/hash";

import {
  type RepositoryManifest,
  type TaskAnalysis,
  type TaskEstimate,
} from "./domain";

export const SNAPSHOT_PRICING_POLICY = {
  id: "snapshot-variable-pricing",
  marginRatio: 0.35,
  paymentAllowanceCents: 55,
  quoteLifetimeMinutes: 30,
  retryBaseRatio: 0.65,
  usdToAudRate: 1.55,
  version: "2.0.0",
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
  const workerExecutionBudgetUsd = Math.max(
    predictedWorkerHighUsd,
    estimate.executionAllowance.softCostLimitUsd,
  );
  const analysisAllowanceUsd = Math.min(
    0.5,
    0.08 +
      manifest.totals.files * 0.001 +
      manifest.packages.length * 0.015 +
      (manifest.baselineSignals.isMonorepo ? 0.12 : 0),
  );
  const verificationAllowanceUsd =
    (manifest.baselineSignals.hasTests ? 0.12 : 0.25) +
    Math.min(0.2, manifest.testFiles.length * 0.005);
  const retryRiskMultiplier =
    SNAPSHOT_PRICING_POLICY.retryBaseRatio +
    (1 - estimate.predicted.successProbability) * 0.75;
  const retryRiskAllowanceUsd =
    (predictedWorkerHighUsd +
      analysisAllowanceUsd +
      verificationAllowanceUsd) *
    retryRiskMultiplier;
  const internalBudgetUsd =
    workerExecutionBudgetUsd +
    analysisAllowanceUsd +
    verificationAllowanceUsd +
    retryRiskAllowanceUsd;
  const costCoverageCents = Math.ceil(
    internalBudgetUsd * SNAPSHOT_PRICING_POLICY.usdToAudRate * 100,
  );
  const marginAllowanceCents = Math.ceil(
    costCoverageCents * SNAPSHOT_PRICING_POLICY.marginRatio,
  );
  const commercialMinimumCents =
    650 +
    Math.min(500, analysis.likelyRelevantFiles.length * 25) +
    (manifest.baselineSignals.isMonorepo ? 250 : 0) +
    (manifest.oversizedFiles.length > 0 ? 150 : 0);
  const fixedPriceCents = Math.max(
    commercialMinimumCents,
    costCoverageCents +
      SNAPSHOT_PRICING_POLICY.paymentAllowanceCents +
      marginAllowanceCents,
  );
  const lowCostCoverageCents = Math.ceil(
    (estimate.predicted.costUsd.low +
      analysisAllowanceUsd * 0.5 +
      verificationAllowanceUsd * 0.75) *
      SNAPSHOT_PRICING_POLICY.usdToAudRate *
      100,
  );
  const lowCents = Math.min(
    fixedPriceCents,
    Math.max(
      450,
      Math.ceil(
        (lowCostCoverageCents +
          SNAPSHOT_PRICING_POLICY.paymentAllowanceCents) *
          1.2,
      ),
    ),
  );
  const factors = [
    `Task family: ${analysis.taskFamily}.`,
    `${analysis.likelyRelevantFiles.length} repository files appear relevant.`,
    manifest.baselineSignals.hasTests
      ? "The snapshot contains test evidence."
      : "The snapshot has no detected test suite, increasing verification uncertainty.",
    manifest.baselineSignals.isMonorepo
      ? "The repository is a monorepo, increasing coordination risk."
      : "The repository is not detected as a monorepo.",
    `The predicted success confidence is ${estimate.confidence}.`,
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
    paymentAllowanceCents: SNAPSHOT_PRICING_POLICY.paymentAllowanceCents,
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
