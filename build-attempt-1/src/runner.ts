import { Agent, type SDKMessage, type TokenUsage } from "@cursor/sdk";
import type {
  ModelRate,
  RepositoryManifest,
  RunLedgerRecord,
  TaskEstimate,
  TaskRequest,
  TokenUsageRecord,
  ToolEventRecord,
} from "./domain.js";
import { calculateUsageCostUsd } from "./rate-card.js";

export interface AgentRunnerInput {
  apiKey: string;
  modelId: string;
  repositoryRoot: string;
  manifest: RepositoryManifest;
  task: TaskRequest;
  estimate: TaskEstimate;
  rate: ModelRate;
}

export type AgentExecution = RunLedgerRecord["execution"];

export interface AgentRunner {
  readonly runtime: "local" | "cloud";
  execute(input: AgentRunnerInput): Promise<AgentExecution>;
}

const addUsage = (
  aggregate: TokenUsageRecord,
  usage: TokenUsage,
): TokenUsageRecord => ({
  inputTokens: aggregate.inputTokens + usage.inputTokens,
  outputTokens: aggregate.outputTokens + usage.outputTokens,
  cacheReadTokens: aggregate.cacheReadTokens + usage.cacheReadTokens,
  cacheWriteTokens: aggregate.cacheWriteTokens + usage.cacheWriteTokens,
  totalTokens: aggregate.totalTokens + usage.totalTokens,
  ...(
    aggregate.reasoningTokens !== undefined || usage.reasoningTokens !== undefined
      ? { reasoningTokens: (aggregate.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0) }
      : {}
  ),
});

const emptyUsage = (): TokenUsageRecord => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
});

interface CloudUsageReconciliation {
  usage: TokenUsageRecord;
  chargedCostUsd?: number;
}

const fetchCloudRunUsage = async (
  apiKey: string,
  agentId: string,
  runId: string,
): Promise<CloudUsageReconciliation | undefined> => {
  try {
    const url = new URL(`https://api.cursor.com/v1/agents/${encodeURIComponent(agentId)}/usage`);
    url.searchParams.set("runId", runId);
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      },
    });
    if (!response.ok) return undefined;
    const payload = await response.json() as {
      runs?: Array<{
        usage?: TokenUsageRecord;
        cost?: { chargedCents?: number };
      }>;
    };
    const runUsage = payload.runs?.[0];
    if (!runUsage?.usage) return undefined;
    return {
      usage: runUsage.usage,
      ...(runUsage.cost?.chargedCents !== undefined
        ? { chargedCostUsd: runUsage.cost.chargedCents / 100 }
        : {}),
    };
  } catch {
    return undefined;
  }
};

const buildAgentPrompt = (
  task: TaskRequest,
  estimate: TaskEstimate,
): string => [
  "Complete the following bounded coding outcome.",
  "",
  `Task: ${task.description}`,
  "",
  "Acceptance criteria:",
  ...(task.acceptanceCriteria.length > 0
    ? task.acceptanceCriteria.map((criterion) => `- ${criterion}`)
    : ["- Complete the requested change and preserve existing behavior."]),
  "",
  "Prohibited changes:",
  ...(task.prohibitedChanges.length > 0
    ? task.prohibitedChanges.map((constraint) => `- ${constraint}`)
    : ["- Do not broaden scope beyond the requested outcome."]),
  "",
  "Execution policy:",
  `- Tool-call allowance: ${estimate.executionAllowance.maxToolCalls}`,
  `- Soft token allowance: ${estimate.executionAllowance.softTokenLimit}`,
  `- Wall-clock allowance: ${estimate.executionAllowance.wallClockSeconds} seconds`,
  "- Read only files relevant to the requested outcome.",
  "- Do not read generated, vendored, binary, or unusually large files.",
  "- Prefer targeted searches and bounded file ranges over whole-file reads.",
  "- Stop and report the blocker if the outcome cannot be completed within scope.",
].join("\n");

export interface ExecuteWithAgentOptions {
  runtime: "local" | "cloud";
  createAgent: () => ReturnType<typeof Agent.create>;
}

export const executeWithAgent = async (
  input: AgentRunnerInput,
  options: ExecuteWithAgentOptions,
): Promise<AgentExecution> => {
  const agent = await options.createAgent();
  const toolEvents: ToolEventRecord[] = [];
  let streamedUsage = emptyUsage();
  const startedToolCallIds = new Set<string>();
  let cancellationReason: string | undefined;
  let cancellationRequested = false;
  let run: Awaited<ReturnType<typeof agent.send>> | undefined;

  const requestCancellation = async (reason: string): Promise<void> => {
    if (!run || cancellationRequested || !run.supports("cancel")) return;
    cancellationRequested = true;
    cancellationReason = reason;
    await run.cancel();
  };

  try {
    run = await agent.send(buildAgentPrompt(input.task, input.estimate), {
      mode: "agent",
      idempotencyKey: `repo-cost:${input.task.id}:${input.manifest.snapshot.commitSha ?? "working-tree"}:${options.runtime}`,
    });

    const watchdog = setTimeout(() => {
      void requestCancellation("wall-clock allowance exceeded").catch(() => undefined);
    }, input.estimate.executionAllowance.wallClockSeconds * 1_000);

    let streamError: unknown;
    try {
      for await (const message of run.stream()) {
        if (message.type === "tool_call") {
          toolEvents.push(toToolEvent(message));
          if (message.status === "running") {
            startedToolCallIds.add(message.call_id);
            if (startedToolCallIds.size > input.estimate.executionAllowance.maxToolCalls) {
              await requestCancellation("tool-call allowance exceeded");
            }
          }
        }

        if (message.type === "usage") {
          streamedUsage = addUsage(streamedUsage, message.usage);
          const costUsd = calculateUsageCostUsd(streamedUsage, input.rate);
          if (streamedUsage.totalTokens > input.estimate.executionAllowance.softTokenLimit) {
            await requestCancellation("soft token allowance exceeded");
          } else if (costUsd > input.estimate.executionAllowance.softCostLimitUsd) {
            await requestCancellation("soft cost allowance exceeded");
          }
        }
      }
    } catch (error) {
      streamError = error;
    } finally {
      clearTimeout(watchdog);
    }

    let result;
    try {
      result = await run.wait();
    } catch (error) {
      throw new Error("Cursor run could not be observed to completion.", {
        cause: streamError ?? error,
      });
    }
    const cloudUsage = options.runtime === "cloud"
      ? await fetchCloudRunUsage(input.apiKey, agent.agentId, result.id)
      : undefined;
    const usage = cloudUsage?.usage ?? (
      result.usage ? toUsageRecord(result.usage) : (
        streamedUsage.totalTokens > 0 ? streamedUsage : undefined
      )
    );
    const actualCostUsd = cloudUsage?.chargedCostUsd ?? (
      usage ? calculateUsageCostUsd(usage, input.rate) : undefined
    );

    return {
      runtime: options.runtime,
      agentId: agent.agentId,
      runId: result.id,
      ...(result.requestId ? { requestId: result.requestId } : {}),
      modelId: result.model?.id ?? input.modelId,
      status: result.status,
      ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
      ...(usage ? { usage } : {}),
      ...(actualCostUsd !== undefined ? { actualCostUsd } : {}),
      toolEvents,
      ...(cancellationReason ? { cancellationReason } : {}),
      ...(result.result ? { result: result.result } : {}),
      ...(result.git ? {
        git: {
          branches: result.git.branches.map((branch) => ({
            repoUrl: branch.repoUrl,
            ...(branch.branch ? { branch: branch.branch } : {}),
            ...(branch.prUrl ? { prUrl: branch.prUrl } : {}),
          })),
        },
      } : {}),
    };
  } finally {
    await agent[Symbol.asyncDispose]();
  }
};

const toUsageRecord = (usage: TokenUsage): TokenUsageRecord => ({
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens,
  cacheWriteTokens: usage.cacheWriteTokens,
  totalTokens: usage.totalTokens,
  ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
});

const toToolEvent = (
  message: Extract<SDKMessage, { type: "tool_call" }>,
): ToolEventRecord => ({
  at: new Date().toISOString(),
  callId: message.call_id,
  name: message.name,
  status: message.status,
  ...(message.truncated?.args !== undefined
    ? { argumentsTruncated: message.truncated.args }
    : {}),
  ...(message.truncated?.result !== undefined
    ? { resultTruncated: message.truncated.result }
    : {}),
});

export class LocalCursorAgentRunner implements AgentRunner {
  readonly runtime = "local" as const;

  execute(input: AgentRunnerInput): Promise<AgentExecution> {
    return executeWithAgent(input, {
      runtime: this.runtime,
      createAgent: () => Agent.create({
        apiKey: input.apiKey,
        model: { id: input.modelId, params: input.rate.modelParams },
        mode: "agent",
        name: `Repository cost spike: ${input.task.id}`,
        local: {
          cwd: input.repositoryRoot,
          settingSources: ["project"],
          sandboxOptions: { enabled: true },
          enableAgentRetries: false,
        },
      }),
    });
  }
}

export class CloudCursorAgentRunner implements AgentRunner {
  readonly runtime = "cloud" as const;

  execute(input: AgentRunnerInput): Promise<AgentExecution> {
    if (input.manifest.source.kind !== "github") {
      throw new Error("Cloud execution requires a GitHub repository source.");
    }
    const githubSource = input.manifest.source;

    return executeWithAgent(input, {
      runtime: this.runtime,
      createAgent: () => Agent.create({
        apiKey: input.apiKey,
        model: { id: input.modelId, params: input.rate.modelParams },
        mode: "agent",
        name: `Repository cost spike: ${input.task.id}`,
        cloud: {
          repos: [{
            url: githubSource.url,
            startingRef: input.manifest.snapshot.commitSha ?? githubSource.ref,
          }],
          autoCreatePR: false,
          skipReviewerRequest: true,
        },
      }),
    });
  }
}
