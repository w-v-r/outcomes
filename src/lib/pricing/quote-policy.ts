import "server-only";

import { createHash } from "node:crypto";

import { type TaskAnalysis, type TaskContract, type TaskEstimate } from "./domain";

export const HACKATHON_PRICING_POLICY = {
  audMinimumCents: 1,
  marginRatio: 0.1,
  maximumRiskRatio: 0.75,
  minimumRiskRatio: 0.1,
  paymentFeeRatio: 0.02,
  quoteLifetimeMinutes: 30,
  usdToAudRate: 1.55,
  version: "charged-cost-v2",
} as const;

export const FIXED_QUOTE_TERMS =
  "Fixed sandbox price. Accrue only after trusted verification; charge the stored payment method in a batch when the outstanding verified balance reaches AUD $10.";

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)]),
    );
  }

  return value;
};

export const createContractHash = (contract: {
  amountCents: number;
  currency: "AUD";
  expiresAt: string;
  pricingEvidence?: unknown;
  pricingEvidenceHash?: string;
  pricingModelVersion: string;
  repositoryEvidence?: unknown;
  repositorySha: string;
  repositoryUrl: string;
  task: TaskContract;
  terms: string;
}) => {
  const normalizedContract = {
    ...contract,
    expiresAt: new Date(contract.expiresAt).toISOString(),
  };

  return createHash("sha256")
    .update(JSON.stringify(canonicalize(normalizedContract)))
    .digest("hex");
};

export const deriveQuote = ({
  analysis,
  estimate,
  now = new Date(),
  repositorySha,
  repositoryUrl,
  task,
}: {
  analysis: TaskAnalysis;
  estimate: TaskEstimate;
  now?: Date;
  repositorySha: string;
  repositoryUrl: string;
  task: TaskContract;
}) => {
  const failureProbability = 1 - estimate.predicted.successProbability;
  const riskRatio = Math.min(
    HACKATHON_PRICING_POLICY.maximumRiskRatio,
    Math.max(
      HACKATHON_PRICING_POLICY.minimumRiskRatio,
      failureProbability / estimate.predicted.successProbability,
    ),
  );
  const executionAndRiskUsd =
    estimate.predicted.costUsd.high * (1 + riskRatio);
  const subtotalCents = Math.ceil(
    executionAndRiskUsd *
      HACKATHON_PRICING_POLICY.usdToAudRate *
      (1 + HACKATHON_PRICING_POLICY.marginRatio) *
      100,
  );
  const amountCents = Math.max(
    1,
    Math.ceil(
      subtotalCents /
        (1 - HACKATHON_PRICING_POLICY.paymentFeeRatio),
    ),
  );
  const expiresAt = new Date(
    now.getTime() +
      HACKATHON_PRICING_POLICY.quoteLifetimeMinutes * 60_000,
  ).toISOString();
  const contract = {
    amountCents,
    currency: "AUD" as const,
    expiresAt,
    pricingModelVersion: HACKATHON_PRICING_POLICY.version,
    repositorySha,
    repositoryUrl,
    task,
    terms: FIXED_QUOTE_TERMS,
  };

  return {
    ...contract,
    analysis,
    contractHash: createContractHash(contract),
    estimate,
    internalCostBudgetUsd: estimate.executionAllowance.softCostLimitUsd,
    predictedCostUsd: estimate.predicted.costUsd.high,
    riskMultiplier: riskRatio,
  };
};
