import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { Agent, CursorSdkError } from "@cursor/sdk";

import { normalizeGitHubRepositoryUrl } from "../src/lib/repositories/github";
import { inspectCursorRepositoryAccess } from "../src/lib/workers/cursor/repository-access";

const DEFAULT_MODEL_ID = "composer-2.5";
const MAX_PROMPT_BYTES = 20_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;

const printJson = (value: unknown) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const requireValue = (
  value: string | undefined,
  flag: string,
): string => {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new Error(`${flag} is required.`);
  }

  return normalizedValue;
};

const main = async () => {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      "confirm-write": { type: "string" },
      execute: { default: false, type: "boolean" },
      model: { type: "string" },
      "prompt-file": { type: "string" },
      repository: { type: "string" },
      sha: { type: "string" },
    },
    strict: true,
  });
  const apiKey = requireValue(
    process.env.CURSOR_API_KEY,
    "CURSOR_API_KEY",
  );
  const repositoryUrl = requireValue(
    values.repository,
    "--repository",
  );
  const access = await inspectCursorRepositoryAccess({
    apiKey,
    repositoryUrl,
  });

  if (!values.execute) {
    printJson({
      access,
      mode: "read_only",
    });
    process.exitCode = access.status === "connected" ? 0 : 2;
    return;
  }

  if (access.status !== "connected") {
    printJson({
      access,
      mode: "write_probe_blocked",
      reason: "The repository is not connected to this Cursor identity.",
    });
    process.exitCode = 2;
    return;
  }

  const repositorySha = requireValue(values.sha, "--sha").toLowerCase();

  if (!SHA_PATTERN.test(repositorySha)) {
    throw new Error("--sha must be a full 40-character Git commit SHA.");
  }

  const confirmation = requireValue(
    values["confirm-write"],
    "--confirm-write",
  );

  if (confirmation !== access.normalizedRepositoryUrl) {
    throw new Error(
      "--confirm-write must exactly match the normalized repository URL.",
    );
  }

  const promptFile = requireValue(
    values["prompt-file"],
    "--prompt-file",
  );
  const prompt = (await readFile(promptFile, "utf8")).trim();

  if (!prompt) {
    throw new Error("The probe prompt file is empty.");
  }

  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw new Error(
      `The probe prompt exceeds ${MAX_PROMPT_BYTES} bytes.`,
    );
  }

  const modelId =
    values.model?.trim() ||
    process.env.OUTCOMES_CURSOR_MODEL?.trim() ||
    DEFAULT_MODEL_ID;
  const probeHash = createHash("sha256")
    .update(access.normalizedRepositoryUrl)
    .update("\0")
    .update(repositorySha)
    .update("\0")
    .update(prompt)
    .digest("hex");
  const agent = await Agent.create({
    apiKey,
    cloud: {
      autoCreatePR: true,
      repos: [
        {
          startingRef: repositorySha,
          url: access.normalizedRepositoryUrl,
        },
      ],
      skipReviewerRequest: true,
    },
    idempotencyKey: `outcomes-repository-probe:${probeHash}`,
    mode: "agent",
    model: { id: modelId },
    name: `Outcomes repository access probe ${probeHash.slice(0, 8)}`,
  });

  try {
    const run = await agent.send(prompt, {
      idempotencyKey: `outcomes-repository-probe-run:${probeHash}`,
      mode: "agent",
    });

    printJson({
      agent_id: agent.agentId,
      mode: "write_probe_started",
      repository_sha: repositorySha,
      repository_url: access.normalizedRepositoryUrl,
      run_id: run.id,
    });

    const result = await run.wait();
    const branch = result.git?.branches.find(
      ({ repoUrl }) =>
        normalizeGitHubRepositoryUrl(repoUrl) ===
        access.normalizedRepositoryUrl,
    );
    const evidence = {
      agent_id: agent.agentId,
      branch: branch?.branch ?? null,
      duration_ms: result.durationMs ?? null,
      error: result.error?.message ?? null,
      mode: "write_probe_finished",
      pr_url: branch?.prUrl ?? null,
      repository_sha: repositorySha,
      repository_url: access.normalizedRepositoryUrl,
      run_id: result.id,
      status: result.status,
      usage: result.usage ?? null,
    };

    printJson(evidence);

    if (
      result.status !== "finished" ||
      !branch?.branch ||
      !branch.prUrl
    ) {
      process.exitCode = 3;
    }
  } finally {
    await agent[Symbol.asyncDispose]();
  }
};

main().catch((error: unknown) => {
  const details =
    error instanceof CursorSdkError
      ? {
          code: error.code ?? null,
          message: error.message,
          retryable: error.isRetryable,
          status: error.status ?? null,
        }
      : {
          message:
            error instanceof Error
              ? error.message
              : "Unknown repository access probe error.",
        };

  process.stderr.write(
    `${JSON.stringify({ error: details }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
