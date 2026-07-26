import "server-only";

import { type ModelRate, type TokenUsageRecord } from "./domain";

export const HACKATHON_MODEL_RATE: ModelRate = {
  cacheReadPerMillionUsd: 0.2,
  cacheWritePerMillionUsd: 0,
  effectiveDate: "2026-07-25",
  id: "composer-2.5",
  inputPerMillionUsd: 0.5,
  label: "Cursor Composer 2.5 standard",
  modelParams: [{ id: "fast", value: "false" }],
  outputPerMillionUsd: 2.5,
  source: "https://cursor.com/docs/models-and-pricing",
};

export const calculateUsageCostUsd = (
  usage: Pick<
    TokenUsageRecord,
    | "inputTokens"
    | "outputTokens"
    | "cacheReadTokens"
    | "cacheWriteTokens"
  >,
  rate: ModelRate = HACKATHON_MODEL_RATE,
): number => {
  const cost =
    (usage.inputTokens * rate.inputPerMillionUsd +
      usage.outputTokens * rate.outputPerMillionUsd +
      usage.cacheReadTokens * rate.cacheReadPerMillionUsd +
      usage.cacheWriteTokens * rate.cacheWritePerMillionUsd) /
    1_000_000;

  return Number(cost.toFixed(8));
};
