import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { modelRateSchema, type ModelRate, type TokenUsageRecord } from "./domain.js";

const rateCardSchema = z.object({
  schemaVersion: z.literal(1),
  models: z.array(modelRateSchema).min(1),
});

const resolveDefaultRateCardPath = async (): Promise<string> => {
  const candidates = [
    fileURLToPath(new URL("../config/rate-card.json", import.meta.url)),
    fileURLToPath(new URL("../../config/rate-card.json", import.meta.url)),
    resolve(process.cwd(), "config/rate-card.json"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next development, built-package, or working-directory location.
    }
  }
  throw new Error("Unable to locate config/rate-card.json");
};

export const loadRateCard = async (path?: string): Promise<ModelRate[]> => {
  const rateCardPath = path ?? await resolveDefaultRateCardPath();
  const rawRateCard = await readFile(rateCardPath, "utf8");
  return rateCardSchema.parse(JSON.parse(rawRateCard)).models;
};

export const getModelRate = (rates: ModelRate[], modelId: string): ModelRate => {
  const rate = rates.find(({ id }) => id === modelId);
  if (!rate) {
    const availableModels = rates.map(({ id }) => id).join(", ");
    throw new Error(`No rate configured for model "${modelId}". Available: ${availableModels}`);
  }
  return rate;
};

export const calculateUsageCostUsd = (
  usage: Pick<TokenUsageRecord, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">,
  rate: ModelRate,
): number => {
  const cost = (
    usage.inputTokens * rate.inputPerMillionUsd
    + usage.outputTokens * rate.outputPerMillionUsd
    + usage.cacheReadTokens * rate.cacheReadPerMillionUsd
    + usage.cacheWriteTokens * rate.cacheWritePerMillionUsd
  ) / 1_000_000;

  return Number(cost.toFixed(8));
};
