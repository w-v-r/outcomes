import {
  SCHEMA_VERSION,
  type RepositoryManifest,
  type RunLedgerRecord,
  type TaskEstimate,
  type TaskRequest,
} from "./domain.js";
import { RunLedger } from "./ledger.js";
import type { ModelRate } from "./domain.js";
import type { AgentRunner } from "./runner.js";
import { runVerifier } from "./verifier.js";
import { resolveRepository } from "./repository.js";

export interface ExecuteTaskWorkflowInput {
  apiKey: string;
  modelId: string;
  repositoryRoot: string;
  manifest: RepositoryManifest;
  task: TaskRequest;
  estimate: TaskEstimate;
  rate: ModelRate;
  runner: AgentRunner;
  ledger: RunLedger;
}

export const executeTaskWorkflow = async (
  input: ExecuteTaskWorkflowInput,
): Promise<RunLedgerRecord> => {
  const execution = await input.runner.execute({
    apiKey: input.apiKey,
    modelId: input.modelId,
    repositoryRoot: input.repositoryRoot,
    manifest: input.manifest,
    task: input.task,
    estimate: input.estimate,
    rate: input.rate,
  });
  const verification = input.task.verifierCommand && execution.status === "finished"
    ? await verifyExecution(input, execution)
    : undefined;
  const actualCostUsd = execution.actualCostUsd;
  const predictedCentralCostUsd = input.estimate.predicted.costUsd.central;
  const centralCostErrorUsd = actualCostUsd === undefined
    ? undefined
    : actualCostUsd - predictedCentralCostUsd;
  const totalTokens = execution.usage?.totalTokens ?? 0;

  const record: RunLedgerRecord = {
    schemaVersion: SCHEMA_VERSION,
    recordedAt: new Date().toISOString(),
    task: input.task,
    repository: {
      source: input.manifest.source,
      commitSha: input.manifest.snapshot.commitSha,
    },
    estimate: input.estimate,
    execution,
    ...(verification ? { verification } : {}),
    comparison: {
      ...(centralCostErrorUsd !== undefined ? {
        centralCostErrorUsd,
        centralCostErrorRatio: predictedCentralCostUsd === 0
          ? 0
          : centralCostErrorUsd / predictedCentralCostUsd,
      } : {}),
      exceededSoftTokenLimit: totalTokens > input.estimate.executionAllowance.softTokenLimit,
      exceededSoftCostLimit: (actualCostUsd ?? 0) > input.estimate.executionAllowance.softCostLimitUsd,
      exceededWallClockLimit: (execution.durationMs ?? 0)
        > input.estimate.executionAllowance.wallClockSeconds * 1_000,
    },
  };

  await input.ledger.append(record);
  return record;
};

const verifyExecution = async (
  input: ExecuteTaskWorkflowInput,
  execution: RunLedgerRecord["execution"],
) => {
  const timeoutMs = Math.min(
    input.estimate.executionAllowance.wallClockSeconds * 1_000,
    300_000,
  );
  if (execution.runtime === "local") {
    return runVerifier(input.task.verifierCommand!, input.repositoryRoot, timeoutMs);
  }

  if (input.manifest.source.kind !== "github") return undefined;
  const repositoryUrl = input.manifest.source.url;
  const branch = execution.git?.branches.find(({ repoUrl }) =>
    repoUrl === repositoryUrl
  )?.branch ?? execution.git?.branches[0]?.branch;
  if (!branch) return undefined;

  const verificationCheckout = await resolveRepository({
    kind: "github",
    url: input.manifest.source.url,
    ref: branch,
  });
  try {
    return await runVerifier(
      input.task.verifierCommand!,
      verificationCheckout.rootPath,
      timeoutMs,
    );
  } finally {
    await verificationCheckout.cleanup();
  }
};
