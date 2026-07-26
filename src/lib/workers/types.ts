import { type TaskContract, type TokenUsageRecord } from "@/lib/pricing/domain";

export type StartWorkerTaskInput = {
  idempotencyKey: string;
  repositorySha: string;
  repositoryUrl: string;
  task: TaskContract;
  taskId: string;
};

export type StartedWorkerTask = {
  agentId: string;
  modelId: string;
  runId: string;
};

export type RefreshedWorkerTask = {
  actualCostUsd?: number;
  branch?: string;
  error?: string;
  output?: string;
  prUrl?: string;
  status: "running" | "finished" | "error" | "cancelled";
  usage?: TokenUsageRecord;
};

export interface WorkerAdapter {
  readonly provider: string;
  readonly runtime: string;
  refreshTask(input: {
    agentId: string;
    runId: string;
  }): Promise<RefreshedWorkerTask>;
  startTask(input: StartWorkerTaskInput): Promise<StartedWorkerTask>;
}
