import "server-only";

import { Agent, type TokenUsage } from "@cursor/sdk";

import { calculateUsageCostUsd } from "@/lib/pricing/rate-card";
import { type TaskContract, type TokenUsageRecord } from "@/lib/pricing/domain";
import {
  type RefreshedWorkerTask,
  type StartedWorkerTask,
  type StartWorkerTaskInput,
  type WorkerAdapter,
} from "@/lib/workers/types";

const DEFAULT_MODEL_ID = "composer-2.5";

const requireCursorApiKey = () => {
  const apiKey = process.env.CURSOR_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is not configured.");
  }

  return apiKey;
};

const toUsageRecord = (usage: TokenUsage): TokenUsageRecord => ({
  cacheReadTokens: usage.cacheReadTokens,
  cacheWriteTokens: usage.cacheWriteTokens,
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  ...(usage.reasoningTokens !== undefined
    ? { reasoningTokens: usage.reasoningTokens }
    : {}),
  totalTokens: usage.totalTokens,
});

export const buildWorkerPrompt = (task: TaskContract) =>
  [
    "Complete exactly the bounded coding outcome below.",
    "",
    `Task: ${task.description}`,
    "",
    "Acceptance criteria:",
    ...task.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    "Prohibited changes:",
    ...task.prohibitedChanges.map((constraint) => `- ${constraint}`),
    "",
    "Execution constraints:",
    "- Make the smallest coherent implementation change.",
    "- Do not modify tests, workflows, hooks, package manifests, or dependencies.",
    "- Do not read docs/large-context.txt.",
    "- Run the repository test command after the change.",
    "- Stop after the acceptance criteria pass.",
  ].join("\n");

export class CursorCloudWorkerAdapter implements WorkerAdapter {
  readonly provider = "cursor";
  readonly runtime = "cloud";

  async startTask(
    input: StartWorkerTaskInput,
  ): Promise<StartedWorkerTask> {
    const apiKey = requireCursorApiKey();
    const modelId =
      process.env.OUTCOMES_CURSOR_MODEL?.trim() || DEFAULT_MODEL_ID;
    const agent = await Agent.create({
      apiKey,
      cloud: {
        autoCreatePR: true,
        repos: [
          {
            startingRef: input.repositorySha,
            url: input.repositoryUrl,
          },
        ],
        skipReviewerRequest: true,
      },
      idempotencyKey: `outcomes-task:${input.taskId}`,
      mode: "agent",
      model: { id: modelId },
      name: `Outcomes task ${input.taskId}`,
    });

    try {
      const run = await agent.send(buildWorkerPrompt(input.task), {
        idempotencyKey: input.idempotencyKey,
        mode: "agent",
      });

      return {
        agentId: agent.agentId,
        modelId,
        runId: run.id,
      };
    } finally {
      await agent[Symbol.asyncDispose]();
    }
  }

  async refreshTask({
    agentId,
    runId,
  }: {
    agentId: string;
    runId: string;
  }): Promise<RefreshedWorkerTask> {
    const apiKey = requireCursorApiKey();
    const run = await Agent.getRun(runId, {
      agentId,
      apiKey,
      runtime: "cloud",
    });

    if (run.status === "running") {
      return { status: "running" };
    }

    const usage = run.usage ? toUsageRecord(run.usage) : undefined;
    const branch = run.git?.branches[0];

    return {
      ...(usage
        ? {
            actualCostUsd: calculateUsageCostUsd(usage),
            usage,
          }
        : {}),
      ...(branch?.branch ? { branch: branch.branch } : {}),
      ...(run.error?.message ? { error: run.error.message } : {}),
      ...(run.result ? { output: run.result } : {}),
      ...(branch?.prUrl ? { prUrl: branch.prUrl } : {}),
      status: run.status,
    };
  }
}
