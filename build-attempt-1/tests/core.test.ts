import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SDKAgent } from "@cursor/sdk";
import { describe, expect, test } from "vitest";
import { taskRequestSchema } from "../src/domain.js";
import { HeuristicCostEstimator } from "../src/estimator.js";
import { RunLedger } from "../src/ledger.js";
import { calculateUsageCostUsd, getModelRate, loadRateCard } from "../src/rate-card.js";
import { renderMarkdownReport } from "../src/report.js";
import { analyzeRepository, resolveRepository } from "../src/repository.js";
import {
  executeWithAgent,
  type AgentExecution,
  type AgentRunner,
  type AgentRunnerInput,
} from "../src/runner.js";
import { analyzeTask } from "../src/task-analysis.js";
import { executeTaskWorkflow } from "../src/workflow.js";

const projectRoot = resolve(import.meta.dirname, "..");
const sampleRepositoryPath = join(projectRoot, "fixtures", "sample-repo");

describe("repository analysis", () => {
  test("produces a deterministic manifest and flags configured oversized files", async () => {
    const repository = await resolveRepository({ kind: "local", path: sampleRepositoryPath });
    const manifest = await analyzeRepository(repository, 1_000);

    expect(manifest.totals.files).toBeGreaterThanOrEqual(7);
    expect(manifest.baselineSignals.hasTests).toBe(true);
    expect(manifest.manifests).toContain("package.json");
    expect(manifest.oversizedFiles.map(({ path }) => path)).toContain("docs/large-context.txt");
    expect(manifest.files.some(({ path }) => path.includes("node_modules"))).toBe(false);
  });

  test("isolates a local checkout before execution", async () => {
    const repository = await resolveRepository(
      { kind: "local", path: sampleRepositoryPath },
      { isolateLocal: true },
    );
    try {
      expect(repository.rootPath).not.toBe(sampleRepositoryPath);
      expect(await readFile(join(repository.rootPath, "src/calculator.js"), "utf8"))
        .toContain("export const divide");
    } finally {
      await repository.cleanup();
    }
  });
});

describe("task analysis and estimation", () => {
  test("works with no historical records and emits a conservative allowance", async () => {
    const repository = await resolveRepository({ kind: "local", path: projectRoot });
    const manifest = await analyzeRepository(repository, 1_000);
    const task = taskRequestSchema.parse(JSON.parse(
      await readFile(join(projectRoot, "fixtures", "success-task.json"), "utf8"),
    ));
    const analysis = analyzeTask(task, manifest);
    const rate = getModelRate(await loadRateCard(), "composer-2.5");
    const estimate = await new HeuristicCostEstimator().estimate({
      task,
      manifest,
      analysis,
      modelRate: rate,
    });

    expect(analysis.likelyRelevantFiles[0]?.path).toContain("calculator");
    expect(estimate.confidence).not.toBe("high");
    expect(estimate.executionAllowance.softTokenLimit)
      .toBeGreaterThan(estimate.predicted.inputTokens.central);
    expect(estimate.historicalEvidence).toBeUndefined();
  });

  test("calculates categorized token cost from the versioned rate", async () => {
    const rate = getModelRate(await loadRateCard(), "composer-2.5");
    expect(calculateUsageCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    }, rate)).toBe(3.2);
  });
});

describe("cost guard hook", () => {
  const hookPath = join(projectRoot, ".cursor", "hooks", "cost-guard.mjs");

  const invokeHook = async (
    input: Record<string, unknown>,
    environment: Record<string, string> = {},
  ): Promise<Record<string, unknown>> => new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [hookPath], {
      env: { ...process.env, ...environment },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Hook failed (${code}): ${stderr}`));
        return;
      }
      resolveResult(JSON.parse(stdout) as Record<string, unknown>);
    });
    child.stdin.end(JSON.stringify(input));
  });

  test("denies oversized reads", async () => {
    const result = await invokeHook({
      hook_event_name: "beforeReadFile",
      file_path: "/repo/src/large.ts",
      content: "12345678901",
    }, { REPO_COST_MAX_FILE_BYTES: "10" });

    expect(result.permission).toBe("deny");
  });

  test("denies tool calls after the persisted session allowance", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cost-hook-test-"));
    try {
      const input = {
        hook_event_name: "preToolUse",
        tool_name: "Read",
        session_id: "session-1",
        cwd,
      };
      expect((await invokeHook(input, { REPO_COST_MAX_TOOL_CALLS: "2" })).permission).toBe("allow");
      expect((await invokeHook(input, { REPO_COST_MAX_TOOL_CALLS: "2" })).permission).toBe("allow");
      expect((await invokeHook(input, { REPO_COST_MAX_TOOL_CALLS: "2" })).permission).toBe("deny");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("execution ledger and reports", () => {
  test("records a zero-history execution and independent verification", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "cost-ledger-test-"));
    const repository = await resolveRepository(
      { kind: "local", path: sampleRepositoryPath },
      { isolateLocal: true },
    );
    try {
      const manifest = await analyzeRepository(repository);
      const task = taskRequestSchema.parse({
        id: "synthetic-run",
        description: "Fix calculator divide behavior.",
        acceptanceCriteria: ["Verifier exits successfully."],
        prohibitedChanges: ["Do not modify tests."],
        verifierCommand: `${process.execPath} -e "process.exit(0)"`,
      });
      const analysis = analyzeTask(task, manifest);
      const rate = getModelRate(await loadRateCard(), "composer-2.5");
      const estimate = await new HeuristicCostEstimator().estimate({
        task,
        manifest,
        analysis,
        modelRate: rate,
      });
      const fakeRunner: AgentRunner = {
        runtime: "local",
        execute: async (_input: AgentRunnerInput): Promise<AgentExecution> => ({
          runtime: "local",
          agentId: "test-agent",
          runId: "test-run",
          modelId: "composer-2.5",
          status: "finished",
          durationMs: 10,
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 120,
          },
          actualCostUsd: calculateUsageCostUsd({
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          }, rate),
          toolEvents: [],
        }),
      };
      const ledger = new RunLedger(join(temporaryDirectory, "runs.jsonl"));

      const record = await executeTaskWorkflow({
        apiKey: "not-used-by-fake",
        modelId: "composer-2.5",
        repositoryRoot: repository.rootPath,
        manifest,
        task,
        estimate,
        rate,
        runner: fakeRunner,
        ledger,
      });

      expect(record.verification?.passed).toBe(true);
      expect(await ledger.readAll()).toHaveLength(1);
      expect(renderMarkdownReport([record])).toContain("synthetic-run");
    } finally {
      await repository.cleanup();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("cancels a run when its wall-clock allowance expires", async () => {
    const repository = await resolveRepository({ kind: "local", path: sampleRepositoryPath });
    const manifest = await analyzeRepository(repository);
    const task = taskRequestSchema.parse({
      id: "watchdog-run",
      description: "Fix calculator divide behavior.",
      acceptanceCriteria: ["Complete within the allowance."],
      prohibitedChanges: [],
    });
    const analysis = analyzeTask(task, manifest);
    const rate = getModelRate(await loadRateCard(), "composer-2.5");
    const estimate = await new HeuristicCostEstimator().estimate({
      task,
      manifest,
      analysis,
      modelRate: rate,
    });
    estimate.executionAllowance.wallClockSeconds = 0.01;
    let cancelled = false;
    const fakeAgent = {
      agentId: "watchdog-agent",
      model: { id: "composer-2.5" },
      send: async () => ({
        id: "watchdog-run",
        agentId: "watchdog-agent",
        supports: () => true,
        unsupportedReason: () => undefined,
        stream: async function* () {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
        },
        conversation: async () => [],
        wait: async () => ({
          id: "watchdog-run",
          status: cancelled ? "cancelled" as const : "finished" as const,
          model: { id: "composer-2.5" },
        }),
        cancel: async () => { cancelled = true; },
        get status() { return cancelled ? "cancelled" as const : "running" as const; },
        onDidChangeStatus: () => () => undefined,
      }),
      close: () => undefined,
      reload: async () => undefined,
      [Symbol.asyncDispose]: async () => undefined,
      listArtifacts: async () => [],
      downloadArtifact: async () => Buffer.from(""),
    } as SDKAgent;

    const execution = await executeWithAgent({
      apiKey: "not-used-by-fake",
      modelId: "composer-2.5",
      repositoryRoot: repository.rootPath,
      manifest,
      task,
      estimate,
      rate,
    }, {
      runtime: "local",
      createAgent: async () => fakeAgent,
    });

    expect(cancelled).toBe(true);
    expect(execution.status).toBe("cancelled");
    expect(execution.cancellationReason).toBe("wall-clock allowance exceeded");
  });
});
