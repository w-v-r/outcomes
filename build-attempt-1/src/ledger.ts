import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunLedgerRecord } from "./domain.js";
import type { HistoricalCostEvidence } from "./estimator.js";

export class RunLedger {
  constructor(readonly path: string) {}

  async append(record: RunLedgerRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }

  async readAll(): Promise<RunLedgerRecord[]> {
    let content: string;
    try {
      content = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    return content
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line) as RunLedgerRecord;
        } catch (error) {
          throw new Error(`Invalid JSONL record at ${this.path}:${index + 1}`, { cause: error });
        }
      });
  }

  async summarizeForTaskFamily(
    taskFamily: string,
    runtime?: "local" | "cloud",
  ): Promise<HistoricalCostEvidence | undefined> {
    const records = (await this.readAll()).filter((record) =>
      record.estimate.reasons.some((reason) => reason === `task family: ${taskFamily}`)
      && (runtime === undefined || record.execution.runtime === runtime),
    );
    if (records.length === 0) return undefined;

    const usageRecords = records.filter(({ execution }) => execution.usage !== undefined);
    const inputTokens = usageRecords
      .map(({ execution }) => execution.usage?.inputTokens ?? 0)
      .sort((left, right) => left - right);
    const outputTokens = usageRecords
      .map(({ execution }) => execution.usage?.outputTokens ?? 0)
      .sort((left, right) => left - right);
    const cacheReadTokens = usageRecords
      .map(({ execution }) => execution.usage?.cacheReadTokens ?? 0)
      .sort((left, right) => left - right);
    const midpoint = Math.floor(usageRecords.length / 2);
    const verifiedRecords = records.filter(({ verification }) => verification !== undefined);
    const verifiedSuccesses = verifiedRecords.filter(({ verification }) => verification?.passed).length;
    const maximumToolCalls = Math.max(
      ...records.map(({ execution }) => new Set(
        execution.toolEvents
          .filter(({ status }) => status === "running")
          .map(({ callId }) => callId),
      ).size),
    );

    return {
      sampleCount: records.length,
      source: `${this.path}${runtime ? `#runtime=${runtime}` : ""}`,
      maxToolCalls: maximumToolCalls,
      ...(usageRecords.length > 0 ? {
        medianInputTokens: inputTokens[midpoint] ?? 0,
        medianOutputTokens: outputTokens[midpoint] ?? 0,
        medianCacheReadTokens: cacheReadTokens[midpoint] ?? 0,
        maxInputTokens: Math.max(...inputTokens),
        maxOutputTokens: Math.max(...outputTokens),
        maxCacheReadTokens: Math.max(...cacheReadTokens),
        maxTotalTokens: Math.max(
          ...usageRecords.map(({ execution }) => execution.usage?.totalTokens ?? 0),
        ),
        maxCostUsd: Math.max(
          ...usageRecords.map(({ execution }) => execution.actualCostUsd ?? 0),
        ),
      } : {}),
      ...(verifiedRecords.length > 0
        ? { verifiedSuccessRate: verifiedSuccesses / verifiedRecords.length }
        : {}),
    };
  }
}
