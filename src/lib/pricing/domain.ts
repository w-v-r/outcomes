import "server-only";

import { z } from "zod";

import { taskContractSchema } from "@outcomes/contracts";

export { taskContractSchema };

export const PRICING_SCHEMA_VERSION = 1 as const;

export const repositoryFileSchema = z.object({
  approximateTokens: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  category: z.enum([
    "source",
    "test",
    "manifest",
    "documentation",
    "generated",
    "binary",
    "other",
  ]),
  extension: z.string(),
  lines: z.number().int().nonnegative(),
  path: z.string(),
});

export const repositoryManifestSchema = z.object({
  baselineSignals: z.object({
    binaryFileCount: z.number().int().nonnegative(),
    generatedFileCount: z.number().int().nonnegative(),
    hasLockfile: z.boolean(),
    hasTests: z.boolean(),
    isMonorepo: z.boolean(),
  }),
  files: z.array(repositoryFileSchema),
  languages: z.record(
    z.object({
      approximateTokens: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
      files: z.number().int().nonnegative(),
    }),
  ),
  manifests: z.array(z.string()),
  oversizedFiles: z.array(
    z.object({
      approximateTokens: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
      path: z.string(),
    }),
  ),
  packages: z.array(z.string()),
  schemaVersion: z.literal(PRICING_SCHEMA_VERSION),
  snapshot: z.object({
    commitSha: z.string().regex(/^[0-9a-f]{40}$/u),
    dirty: z.literal(false),
  }),
  source: z.object({
    kind: z.literal("github"),
    ref: z.string(),
    url: z.string().url(),
  }),
  testFiles: z.array(z.string()),
  totals: z.object({
    approximateTokens: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    files: z.number().int().nonnegative(),
    lines: z.number().int().nonnegative(),
  }),
});

export const taskRequestSchema = taskContractSchema.extend({
  id: z.string().trim().min(1).max(120),
});

export const taskAnalysisSchema = z.object({
  boundednessScore: z.number().min(0).max(1),
  clarityScore: z.number().min(0).max(1),
  likelyRelevantFiles: z.array(
    z.object({
      approximateTokens: z.number().int().nonnegative(),
      path: z.string(),
      reasons: z.array(z.string()),
      score: z.number().nonnegative(),
    }),
  ),
  relevantWorkingSetTokens: z.number().int().nonnegative(),
  requestTokens: z.number().int().nonnegative(),
  signals: z.array(z.string()),
  taskFamily: z.enum([
    "bug-fix",
    "feature",
    "refactor",
    "test",
    "documentation",
    "investigation",
    "migration",
    "unknown",
  ]),
  verifiabilityScore: z.number().min(0).max(1),
});

const estimateRangeSchema = z.object({
  central: z.number().nonnegative(),
  high: z.number().nonnegative(),
  low: z.number().nonnegative(),
});

export const taskEstimateSchema = z.object({
  assumptions: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  decision: z.enum(["accept", "accept_with_conditions", "decompose", "decline"]),
  estimator: z.object({
    id: z.string(),
    version: z.string(),
  }),
  executionAllowance: z.object({
    maxToolCalls: z.number().int().positive(),
    softCostLimitUsd: z.number().positive(),
    softTokenLimit: z.number().int().positive(),
    wallClockSeconds: z.number().int().positive(),
  }),
  generatedAt: z.string().datetime(),
  predicted: z.object({
    cacheReadTokens: estimateRangeSchema,
    costUsd: estimateRangeSchema,
    filesTouched: estimateRangeSchema,
    inputTokens: estimateRangeSchema,
    llmCalls: estimateRangeSchema,
    outputTokens: estimateRangeSchema,
    runtimeSeconds: estimateRangeSchema,
    successProbability: z.number().min(0).max(1),
  }),
  reasons: z.array(z.string()),
  schemaVersion: z.literal(PRICING_SCHEMA_VERSION),
});

export const modelRateSchema = z.object({
  cacheReadPerMillionUsd: z.number().nonnegative(),
  cacheWritePerMillionUsd: z.number().nonnegative(),
  effectiveDate: z.string(),
  id: z.string(),
  inputPerMillionUsd: z.number().nonnegative(),
  label: z.string(),
  modelParams: z
    .array(
      z.object({
        id: z.string(),
        value: z.string(),
      }),
    )
    .default([]),
  outputPerMillionUsd: z.number().nonnegative(),
  source: z.string(),
});

export type ModelRate = z.infer<typeof modelRateSchema>;
export type RepositoryFile = z.infer<typeof repositoryFileSchema>;
export type RepositoryManifest = z.infer<typeof repositoryManifestSchema>;
export type TaskAnalysis = z.infer<typeof taskAnalysisSchema>;
export type TaskContract = z.infer<typeof taskContractSchema>;
export type TaskEstimate = z.infer<typeof taskEstimateSchema>;
export type TaskRequest = z.infer<typeof taskRequestSchema>;

export type TokenUsageRecord = {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
};
