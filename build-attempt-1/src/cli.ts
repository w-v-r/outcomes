#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  taskRequestSchema,
  type RepositoryManifest,
  type RunLedgerRecord,
  type TaskAnalysis,
  type TaskEstimate,
  type TaskRequest,
} from "./domain.js";
import { HeuristicCostEstimator } from "./estimator.js";
import { RunLedger } from "./ledger.js";
import { getModelRate, loadRateCard } from "./rate-card.js";
import {
  writeBenchmarkReports,
  writeDryRunReports,
  type DryRunEstimate,
} from "./report.js";
import {
  analyzeRepository,
  resolveRepository,
  type RepositoryInput,
  type ResolvedRepository,
} from "./repository.js";
import {
  CloudCursorAgentRunner,
  LocalCursorAgentRunner,
  type AgentRunner,
} from "./runner.js";
import { analyzeTask } from "./task-analysis.js";
import { executeTaskWorkflow } from "./workflow.js";

type OptionValue = string | boolean;
type ParsedOptions = Record<string, OptionValue>;

const taskListSchema = z.array(taskRequestSchema).min(1);

const HELP = `
Repository Cost and Runner Spike

Commands:
  analyze    Scan a repository and identify the task's likely working set
  estimate   Analyze and produce a heuristic execution estimate
  run        Estimate, execute with a Cursor agent, verify, and record the run
  benchmark  Run a task fixture list through local and/or cloud agents
  report     Generate reports from one or more existing run ledgers

Repository options:
  --repo <path>                 Local repository path
  --github-url <url> --ref <r>  GitHub repository and pinned branch/tag/SHA

Common options:
  --task-file <path>            JSON task object
  --model <id>                  Fixed model (default: composer-2.5)
  --rate-card <path>            Versioned model rate card
  --output <path>               JSON output path; stdout when omitted
  --oversized-bytes <number>    Oversized text threshold (default: 128000)

Run options:
  --runtime <local|cloud>
  --ledger <path>               JSONL run ledger (default: artifacts/runs.jsonl)

Benchmark options:
  --tasks-file <path>           JSON array of task objects
  --runtimes <list>             Comma-separated local,cloud (default: local,cloud)
  --dry-run                     Analyze and estimate without executing agents
  --report-json <path>          Default: artifacts/benchmark.json
  --report-markdown <path>      Default: artifacts/benchmark.md

Report options:
  --ledgers <list>              Comma-separated JSONL ledgers
  --latest-per-runtime          Keep only the latest local and cloud records
  --report-json <path>          Default: artifacts/benchmark.json
  --report-markdown <path>      Default: artifacts/benchmark.md

Execution reads CURSOR_API_KEY from the environment.
`.trim();

const parseOptions = (args: string[]): { command: string; options: ParsedOptions } => {
  const [command = "help", ...optionArgs] = args;
  const options: ParsedOptions = {};
  for (let index = 0; index < optionArgs.length; index += 1) {
    const argument = optionArgs[index];
    if (!argument?.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2);
    const next = optionArgs[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return { command, options };
};

const optionalString = (options: ParsedOptions, key: string): string | undefined => {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
};

const requiredString = (options: ParsedOptions, key: string): string => {
  const value = optionalString(options, key);
  if (!value) throw new Error(`Missing required option --${key}`);
  return value;
};

const numberOption = (
  options: ParsedOptions,
  key: string,
  fallback: number,
): number => {
  const rawValue = optionalString(options, key);
  if (!rawValue) return fallback;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${key} must be a positive number`);
  }
  return value;
};

const getRepositoryInput = (options: ParsedOptions): RepositoryInput => {
  const githubUrl = optionalString(options, "github-url");
  if (githubUrl) {
    return {
      kind: "github",
      url: githubUrl,
      ref: requiredString(options, "ref"),
    };
  }
  return {
    kind: "local",
    path: resolve(optionalString(options, "repo") ?? "."),
  };
};

const readJson = async (path: string): Promise<unknown> => (
  JSON.parse(await readFile(resolve(path), "utf8"))
);

const readTask = async (options: ParsedOptions): Promise<TaskRequest> => (
  taskRequestSchema.parse(await readJson(requiredString(options, "task-file")))
);

const writeJsonOutput = async (
  value: unknown,
  outputPath?: string,
): Promise<void> => {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  if (!outputPath) {
    process.stdout.write(json);
    return;
  }
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, json, "utf8");
  process.stdout.write(`${absolutePath}\n`);
};

interface PreparedEstimate {
  repository: ResolvedRepository;
  manifest: RepositoryManifest;
  task: TaskRequest;
  analysis: TaskAnalysis;
  estimate: TaskEstimate;
  modelId: string;
  rate: Awaited<ReturnType<typeof getModelRate>>;
}

const prepareEstimate = async (
  options: ParsedOptions,
  task: TaskRequest,
  isolateLocal: boolean,
  runtime?: AgentRunner["runtime"],
): Promise<PreparedEstimate> => {
  const repository = await resolveRepository(getRepositoryInput(options), { isolateLocal });
  try {
    const manifest = await analyzeRepository(
      repository,
      numberOption(options, "oversized-bytes", 128_000),
    );
    const analysis = analyzeTask(task, manifest);
    const modelId = optionalString(options, "model") ?? "composer-2.5";
    const rates = await loadRateCard(
      optionalString(options, "rate-card")
        ? resolve(requiredString(options, "rate-card"))
        : undefined,
    );
    const rate = getModelRate(rates, modelId);
    const ledger = new RunLedger(
      resolve(optionalString(options, "ledger") ?? "artifacts/runs.jsonl"),
    );
    const historicalEvidence = await ledger.summarizeForTaskFamily(
      analysis.taskFamily,
      runtime,
    );
    const estimate = await new HeuristicCostEstimator().estimate({
      task,
      manifest,
      analysis,
      modelRate: rate,
      ...(historicalEvidence ? { historicalEvidence } : {}),
    });

    return { repository, manifest, task, analysis, estimate, modelId, rate };
  } catch (error) {
    await repository.cleanup();
    throw error;
  }
};

const runnerFor = (runtime: string): AgentRunner => {
  if (runtime === "local") return new LocalCursorAgentRunner();
  if (runtime === "cloud") return new CloudCursorAgentRunner();
  throw new Error(`Unsupported runtime "${runtime}". Use local or cloud.`);
};

const requireApiKey = (): string => {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) throw new Error("CURSOR_API_KEY is required for agent execution.");
  return apiKey;
};

const handleAnalyze = async (options: ParsedOptions): Promise<void> => {
  const task = await readTask(options);
  const repository = await resolveRepository(getRepositoryInput(options));
  try {
    const manifest = await analyzeRepository(
      repository,
      numberOption(options, "oversized-bytes", 128_000),
    );
    await writeJsonOutput(
      { manifest, task, analysis: analyzeTask(task, manifest) },
      optionalString(options, "output"),
    );
  } finally {
    await repository.cleanup();
  }
};

const handleEstimate = async (options: ParsedOptions): Promise<void> => {
  const prepared = await prepareEstimate(options, await readTask(options), false);
  try {
    await writeJsonOutput({
      manifest: prepared.manifest,
      task: prepared.task,
      analysis: prepared.analysis,
      estimate: prepared.estimate,
      rate: prepared.rate,
    }, optionalString(options, "output"));
  } finally {
    await prepared.repository.cleanup();
  }
};

const executePrepared = async (
  prepared: PreparedEstimate,
  options: ParsedOptions,
  runtime: string,
): Promise<RunLedgerRecord> => executeTaskWorkflow({
  apiKey: requireApiKey(),
  modelId: prepared.modelId,
  repositoryRoot: prepared.repository.rootPath,
  manifest: prepared.manifest,
  task: prepared.task,
  estimate: prepared.estimate,
  rate: prepared.rate,
  runner: runnerFor(runtime),
  ledger: new RunLedger(resolve(optionalString(options, "ledger") ?? "artifacts/runs.jsonl")),
});

const handleRun = async (options: ParsedOptions): Promise<void> => {
  const runtime = runnerFor(requiredString(options, "runtime")).runtime;
  const prepared = await prepareEstimate(
    options,
    await readTask(options),
    runtime === "local",
    runtime,
  );
  try {
    const record = await executePrepared(prepared, options, runtime);
    await writeJsonOutput(record, optionalString(options, "output"));
  } finally {
    await prepared.repository.cleanup();
  }
};

const handleBenchmark = async (options: ParsedOptions): Promise<void> => {
  const tasks = taskListSchema.parse(
    await readJson(requiredString(options, "tasks-file")),
  );
  const runtimes = (optionalString(options, "runtimes") ?? "local,cloud")
    .split(",")
    .map((runtime) => runtime.trim())
    .filter(Boolean);
  const dryRun = options["dry-run"] === true;
  const estimates: DryRunEstimate[] = [];
  const records: RunLedgerRecord[] = [];

  if (!dryRun) requireApiKey();
  for (const task of tasks) {
    for (const runtime of runtimes) {
      const benchmarkRuntime = runnerFor(runtime).runtime;
      const prepared = await prepareEstimate(
        options,
        task,
        benchmarkRuntime === "local",
        benchmarkRuntime,
      );
      try {
        if (dryRun) {
          estimates.push({
            task,
            runtime: benchmarkRuntime,
            analysis: prepared.analysis,
            estimate: prepared.estimate,
          });
        } else {
          records.push(await executePrepared(prepared, options, benchmarkRuntime));
        }
      } finally {
        await prepared.repository.cleanup();
      }
    }
  }

  if (dryRun) {
    const jsonPath = resolve(
      optionalString(options, "output") ?? "artifacts/benchmark-estimates.json",
    );
    const markdownPath = resolve(
      optionalString(options, "report-markdown") ?? "artifacts/benchmark-estimates.md",
    );
    await writeDryRunReports(estimates, jsonPath, markdownPath);
    process.stdout.write(`${jsonPath}\n${markdownPath}\n`);
    return;
  }

  const summary = await writeBenchmarkReports(
    records,
    resolve(optionalString(options, "report-json") ?? "artifacts/benchmark.json"),
    resolve(optionalString(options, "report-markdown") ?? "artifacts/benchmark.md"),
  );
  await writeJsonOutput(summary, optionalString(options, "output"));
};

const handleReport = async (options: ParsedOptions): Promise<void> => {
  const ledgerPaths = (optionalString(options, "ledgers") ?? "artifacts/runs.jsonl")
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean);
  let records = (
    await Promise.all(ledgerPaths.map((path) => new RunLedger(resolve(path)).readAll()))
  ).flat();
  if (options["latest-per-runtime"] === true) {
    const latestRecords = new Map<RunLedgerRecord["execution"]["runtime"], RunLedgerRecord>();
    for (const record of records) {
      const current = latestRecords.get(record.execution.runtime);
      if (!current || current.recordedAt < record.recordedAt) {
        latestRecords.set(record.execution.runtime, record);
      }
    }
    records = [...latestRecords.values()];
  }
  const summary = await writeBenchmarkReports(
    records,
    resolve(optionalString(options, "report-json") ?? "artifacts/benchmark.json"),
    resolve(optionalString(options, "report-markdown") ?? "artifacts/benchmark.md"),
  );
  await writeJsonOutput(summary, optionalString(options, "output"));
};

export const main = async (args = process.argv.slice(2)): Promise<void> => {
  const { command, options } = parseOptions(args);
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (command === "analyze") return handleAnalyze(options);
  if (command === "estimate") return handleEstimate(options);
  if (command === "run") return handleRun(options);
  if (command === "benchmark") return handleBenchmark(options);
  if (command === "report") return handleReport(options);
  throw new Error(`Unknown command "${command}".\n\n${HELP}`);
};

const isEntrypoint = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
