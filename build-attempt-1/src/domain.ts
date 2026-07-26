import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

export const repositoryFileSchema = z.object({
  path: z.string(),
  extension: z.string(),
  bytes: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  approximateTokens: z.number().int().nonnegative(),
  category: z.enum(["source", "test", "manifest", "documentation", "generated", "binary", "other"]),
});

export const repositoryManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.string().datetime(),
  source: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("local"),
      path: z.string(),
    }),
    z.object({
      kind: z.literal("github"),
      url: z.string().url(),
      ref: z.string(),
    }),
  ]),
  snapshot: z.object({
    commitSha: z.string().nullable(),
    dirty: z.boolean(),
  }),
  totals: z.object({
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    lines: z.number().int().nonnegative(),
    approximateTokens: z.number().int().nonnegative(),
  }),
  languages: z.record(z.string(), z.object({
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    approximateTokens: z.number().int().nonnegative(),
  })),
  packages: z.array(z.string()),
  manifests: z.array(z.string()),
  testFiles: z.array(z.string()),
  oversizedFiles: z.array(z.object({
    path: z.string(),
    bytes: z.number().int().nonnegative(),
    approximateTokens: z.number().int().nonnegative(),
  })),
  baselineSignals: z.object({
    hasTests: z.boolean(),
    hasLockfile: z.boolean(),
    isMonorepo: z.boolean(),
    generatedFileCount: z.number().int().nonnegative(),
    binaryFileCount: z.number().int().nonnegative(),
  }),
  files: z.array(repositoryFileSchema),
});

export const taskRequestSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  prohibitedChanges: z.array(z.string().min(1)).default([]),
  verifierCommand: z.string().min(1).optional(),
});

export const relevantFileSchema = z.object({
  path: z.string(),
  score: z.number().nonnegative(),
  reasons: z.array(z.string()),
  approximateTokens: z.number().int().nonnegative(),
});

export const taskAnalysisSchema = z.object({
  taskFamily: z.enum(["bug-fix", "feature", "refactor", "test", "documentation", "investigation", "migration", "unknown"]),
  requestTokens: z.number().int().nonnegative(),
  clarityScore: z.number().min(0).max(1),
  boundednessScore: z.number().min(0).max(1),
  verifiabilityScore: z.number().min(0).max(1),
  likelyRelevantFiles: z.array(relevantFileSchema),
  relevantWorkingSetTokens: z.number().int().nonnegative(),
  signals: z.array(z.string()),
});

export const taskEstimateSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  estimator: z.object({
    id: z.string(),
    version: z.string(),
  }),
  generatedAt: z.string().datetime(),
  decision: z.enum(["accept", "accept_with_conditions", "decompose", "decline"]),
  confidence: z.enum(["low", "medium", "high"]),
  predicted: z.object({
    inputTokens: z.object({ low: z.number(), central: z.number(), high: z.number() }),
    outputTokens: z.object({ low: z.number(), central: z.number(), high: z.number() }),
    cacheReadTokens: z.object({ low: z.number(), central: z.number(), high: z.number() }),
    costUsd: z.object({ low: z.number(), central: z.number(), high: z.number() }),
    runtimeSeconds: z.object({ low: z.number(), central: z.number(), high: z.number() }),
    successProbability: z.number().min(0).max(1),
  }),
  executionAllowance: z.object({
    softTokenLimit: z.number().int().positive(),
    softCostLimitUsd: z.number().positive(),
    wallClockSeconds: z.number().int().positive(),
    maxToolCalls: z.number().int().positive(),
  }),
  assumptions: z.array(z.string()),
  reasons: z.array(z.string()),
  historicalEvidence: z.object({
    sampleCount: z.number().int().nonnegative(),
    source: z.string(),
  }).optional(),
});

export const modelRateSchema = z.object({
  id: z.string(),
  label: z.string(),
  inputPerMillionUsd: z.number().nonnegative(),
  outputPerMillionUsd: z.number().nonnegative(),
  cacheReadPerMillionUsd: z.number().nonnegative(),
  cacheWritePerMillionUsd: z.number().nonnegative(),
  modelParams: z.array(z.object({
    id: z.string(),
    value: z.string(),
  })).default([]),
  source: z.string(),
  effectiveDate: z.string(),
});

export type RepositoryFile = z.infer<typeof repositoryFileSchema>;
export type RepositoryManifest = z.infer<typeof repositoryManifestSchema>;
export type TaskRequest = z.infer<typeof taskRequestSchema>;
export type TaskAnalysis = z.infer<typeof taskAnalysisSchema>;
export type TaskEstimate = z.infer<typeof taskEstimateSchema>;
export type ModelRate = z.infer<typeof modelRateSchema>;

export interface TokenUsageRecord {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

export interface ToolEventRecord {
  at: string;
  callId: string;
  name: string;
  status: "running" | "completed" | "error";
  argumentsTruncated?: boolean;
  resultTruncated?: boolean;
}

export interface VerificationResult {
  command: string;
  passed: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunLedgerRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  recordedAt: string;
  task: TaskRequest;
  repository: {
    source: RepositoryManifest["source"];
    commitSha: string | null;
  };
  estimate: TaskEstimate;
  execution: {
    runtime: "local" | "cloud";
    agentId: string;
    runId: string;
    requestId?: string;
    modelId: string;
    status: "finished" | "error" | "cancelled";
    durationMs?: number;
    usage?: TokenUsageRecord;
    actualCostUsd?: number;
    toolEvents: ToolEventRecord[];
    cancellationReason?: string;
    result?: string;
    git?: {
      branches: Array<{ repoUrl: string; branch?: string; prUrl?: string }>;
    };
  };
  verification?: VerificationResult;
  comparison: {
    centralCostErrorUsd?: number;
    centralCostErrorRatio?: number;
    exceededSoftTokenLimit: boolean;
    exceededSoftCostLimit: boolean;
    exceededWallClockLimit: boolean;
  };
}
