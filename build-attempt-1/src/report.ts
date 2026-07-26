import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  RunLedgerRecord,
  TaskAnalysis,
  TaskEstimate,
  TaskRequest,
} from "./domain.js";

export interface BenchmarkSummary {
  generatedAt: string;
  records: number;
  successfulExecutions: number;
  verifiedSuccesses: number;
  cancelledExecutions: number;
  averageActualCostUsd: number | null;
  averageAbsoluteCentralCostErrorUsd: number | null;
  softTokenOverruns: number;
  softCostOverruns: number;
  wallClockOverruns: number;
  byRuntime: Record<string, {
    records: number;
    successfulExecutions: number;
    totalCostUsd: number;
    totalTokens: number;
  }>;
}

export interface DryRunEstimate {
  task: TaskRequest;
  runtime: string;
  analysis: TaskAnalysis;
  estimate: TaskEstimate;
}

export const summarizeRecords = (records: RunLedgerRecord[]): BenchmarkSummary => {
  const withCost = records.filter(({ execution }) => execution.actualCostUsd !== undefined);
  const withCostError = records.filter(
    ({ comparison }) => comparison.centralCostErrorUsd !== undefined,
  );
  const byRuntime: BenchmarkSummary["byRuntime"] = {};

  for (const record of records) {
    const runtime = record.execution.runtime;
    const aggregate = byRuntime[runtime] ?? {
      records: 0,
      successfulExecutions: 0,
      totalCostUsd: 0,
      totalTokens: 0,
    };
    aggregate.records += 1;
    if (record.execution.status === "finished") aggregate.successfulExecutions += 1;
    aggregate.totalCostUsd += record.execution.actualCostUsd ?? 0;
    aggregate.totalTokens += record.execution.usage?.totalTokens ?? 0;
    byRuntime[runtime] = aggregate;
  }

  return {
    generatedAt: new Date().toISOString(),
    records: records.length,
    successfulExecutions: records.filter(({ execution }) => execution.status === "finished").length,
    verifiedSuccesses: records.filter(({ verification }) => verification?.passed).length,
    cancelledExecutions: records.filter(({ execution }) => execution.status === "cancelled").length,
    averageActualCostUsd: withCost.length === 0
      ? null
      : withCost.reduce((total, { execution }) => total + (execution.actualCostUsd ?? 0), 0)
        / withCost.length,
    averageAbsoluteCentralCostErrorUsd: withCostError.length === 0
      ? null
      : withCostError.reduce(
        (total, { comparison }) => total + Math.abs(comparison.centralCostErrorUsd ?? 0),
        0,
      ) / withCostError.length,
    softTokenOverruns: records.filter(({ comparison }) => comparison.exceededSoftTokenLimit).length,
    softCostOverruns: records.filter(({ comparison }) => comparison.exceededSoftCostLimit).length,
    wallClockOverruns: records.filter(({ comparison }) => comparison.exceededWallClockLimit).length,
    byRuntime,
  };
};

const formatUsd = (value: number | null): string => (
  value === null ? "n/a" : `$${value.toFixed(6)}`
);

export const renderMarkdownReport = (
  records: RunLedgerRecord[],
  summary = summarizeRecords(records),
): string => {
  const lines = [
    "# Repository Cost Benchmark",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Runs: ${summary.records}`,
    `- Finished executions: ${summary.successfulExecutions}`,
    `- Verified successes: ${summary.verifiedSuccesses}`,
    `- Cancelled executions: ${summary.cancelledExecutions}`,
    `- Average actual model cost: ${formatUsd(summary.averageActualCostUsd)}`,
    `- Average absolute central-estimate error: ${formatUsd(summary.averageAbsoluteCentralCostErrorUsd)}`,
    `- Soft token overruns: ${summary.softTokenOverruns}`,
    `- Soft cost overruns: ${summary.softCostOverruns}`,
    `- Wall-clock overruns: ${summary.wallClockOverruns}`,
    "",
    "## Runs",
    "",
    "| Task | Runtime | Status | Verified | Predicted central | Actual | Tokens | Tool calls |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: |",
    ...records.map((record) => [
      record.task.id,
      record.execution.runtime,
      record.execution.status,
      record.verification ? (record.verification.passed ? "yes" : "no") : "n/a",
      formatUsd(record.estimate.predicted.costUsd.central),
      formatUsd(record.execution.actualCostUsd ?? null),
      String(record.execution.usage?.totalTokens ?? 0),
      String(new Set(
        record.execution.toolEvents
          .filter(({ status }) => status === "running")
          .map(({ callId }) => callId),
      ).size),
    ].join(" | ").replace(/^/u, "| ").replace(/$/u, " |")),
    "",
    "## Enforcement caveats",
    "",
    "- Token and dollar limits are soft: Cursor reports usage at turn completion.",
    "- Cancellation can overshoot by one in-flight model turn.",
    "- Cloud agents may perform early read-only exploration before project hooks load.",
    "- Dollar values use the versioned local rate card and may differ from subscription billing.",
    "",
  ];
  return lines.join("\n");
};

export const writeBenchmarkReports = async (
  records: RunLedgerRecord[],
  jsonPath: string,
  markdownPath: string,
): Promise<BenchmarkSummary> => {
  const summary = summarizeRecords(records);
  await mkdir(dirname(jsonPath), { recursive: true });
  await mkdir(dirname(markdownPath), { recursive: true });
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify({ summary, records }, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderMarkdownReport(records, summary), "utf8"),
  ]);
  return summary;
};

export const renderDryRunReport = (estimates: DryRunEstimate[]): string => [
  "# Repository Cost Benchmark — Estimate Only",
  "",
  "No agents were executed. These values are uncalibrated heuristic predictions.",
  "",
  "| Task | Runtime | Decision | Confidence | Central cost | High cost | Soft token limit |",
  "| --- | --- | --- | --- | ---: | ---: | ---: |",
  ...estimates.map(({ task, runtime, estimate }) => [
    task.id,
    runtime,
    estimate.decision,
    estimate.confidence,
    formatUsd(estimate.predicted.costUsd.central),
    formatUsd(estimate.predicted.costUsd.high),
    String(estimate.executionAllowance.softTokenLimit),
  ].join(" | ").replace(/^/u, "| ").replace(/$/u, " |")),
  "",
  "Actual cost, verification, overshoot, and margin cannot be reported until authenticated runs complete.",
  "",
].join("\n");

export const writeDryRunReports = async (
  estimates: DryRunEstimate[],
  jsonPath: string,
  markdownPath: string,
): Promise<void> => {
  await mkdir(dirname(jsonPath), { recursive: true });
  await mkdir(dirname(markdownPath), { recursive: true });
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      estimates,
    }, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderDryRunReport(estimates), "utf8"),
  ]);
};
