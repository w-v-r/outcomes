import { Agent, type TokenUsage } from "@cursor/sdk";

export type IsolatedCursorRunInput = {
  idempotencyKey: string;
  modelId: string;
  name: string;
  prompt: string;
  workspaceDirectory: string;
};

export type IsolatedCursorRunResult = {
  actualCostUsd: number | null;
  agentId: string;
  error: string | null;
  output: string | null;
  runId: string;
  status: "cancelled" | "error" | "finished";
  usage: TokenUsage | null;
};

const fetchChargedCostUsd = async ({
  agentId,
  apiKey,
  runId,
}: {
  agentId: string;
  apiKey: string;
  runId: string;
}): Promise<number | null> => {
  try {
    const url = new URL(
      `https://api.cursor.com/v1/agents/${encodeURIComponent(agentId)}/usage`,
    );
    url.searchParams.set("runId", runId);
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      runs?: Array<{ cost?: { chargedCents?: number } }>;
    };
    const chargedCents = payload.runs?.[0]?.cost?.chargedCents;

    return typeof chargedCents === "number"
      ? chargedCents / 100
      : null;
  } catch {
    return null;
  }
};

const buildIsolatedPrompt = (prompt: string): string =>
  [
    "Work only inside the provided isolated checkout.",
    "Do not use Git, GitHub, network tools, environment inspection, or credential stores.",
    "Do not create commits, branches, or pull requests.",
    "Make only the smallest file changes needed for the bounded task.",
    "Stop after validating the requested change with repository-local tools.",
    "",
    "Bounded task:",
    prompt,
  ].join("\n");

const shouldEnableLocalSandbox = (): boolean => {
  if (process.env.OUTCOMES_CURSOR_SANDBOX === "0") {
    return false;
  }

  // Vercel serverless does not support the Cursor local sandbox runtime.
  return process.env.VERCEL !== "1";
};

export const executeIsolatedCursorRun = async ({
  apiKey,
  input,
}: {
  apiKey: string;
  input: IsolatedCursorRunInput;
}): Promise<IsolatedCursorRunResult> => {
  const agent = await Agent.create({
    apiKey,
    idempotencyKey: input.idempotencyKey,
    local: {
      autoReview: true,
      cwd: input.workspaceDirectory,
      sandboxOptions: { enabled: shouldEnableLocalSandbox() },
      settingSources: [],
    },
    mcpServers: {},
    mode: "agent",
    model: { id: input.modelId },
    name: input.name,
  });

  try {
    const run = await agent.send(buildIsolatedPrompt(input.prompt), {
      idempotencyKey: `${input.idempotencyKey}:run`,
      mode: "agent",
    });
    const result = await run.wait();
    const actualCostUsd = await fetchChargedCostUsd({
      agentId: agent.agentId,
      apiKey,
      runId: result.id,
    });

    return {
      actualCostUsd,
      agentId: agent.agentId,
      error: result.error?.message ?? null,
      output: result.result ?? null,
      runId: result.id,
      status: result.status,
      usage: result.usage ?? null,
    };
  } finally {
    await agent[Symbol.asyncDispose]();
  }
};
