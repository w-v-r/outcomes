import {
  CLI_EXIT,
  isTerminalTaskStatus,
} from "@outcomes/contracts";
import { OutcomesClientError } from "@outcomes/client";

import type { CliContext } from "../context.js";
import {
  exitForStatusQuery,
  exitForWatchTaskStatus,
  mapClientErrorToExit,
} from "../exit-mapping.js";
import {
  formatTaskOutcomeHuman,
  logProgress,
  writeJson,
} from "../output/format.js";
import { CliAbortError, throwIfAborted } from "../signal.js";

export type WatchOptions = {
  intervalMs: number;
  signal?: AbortSignal;
  taskId: string;
  timeoutMs: number;
  watch: boolean;
};

export type StatusCommandResult = {
  exitCode: number;
  response?: Awaited<
    ReturnType<CliContext["client"]["getTaskStatus"]>
  >;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CliAbortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CliAbortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });

export const runStatus = async (
  context: CliContext,
  options: WatchOptions,
): Promise<StatusCommandResult> => {
  const startedAt = Date.now();

  while (true) {
    throwIfAborted(options.signal);

    let response;

    try {
      response = await context.client.getTaskStatus(
        options.taskId,
        options.signal,
      );
    } catch (error) {
      if (error instanceof OutcomesClientError) {
        if (error.code === "abort") {
          throw new CliAbortError();
        }

        logProgress(error.message);
        return { exitCode: mapClientErrorToExit(error) };
      }

      throw error;
    }

    context.state.putTask(`task:${options.taskId}`, options.taskId);

    if (!options.watch) {
      if (context.outputMode === "json") {
        writeJson(response);
      } else {
        logProgress(formatTaskOutcomeHuman(response.task));
      }

      return { exitCode: exitForStatusQuery(), response };
    }

    logProgress(
      `[watch] ${response.task.status}${
        response.task.execution?.state === "retry_wait"
          ? ` — retry ${response.task.execution.failure_count}, next ${response.task.execution.next_attempt_at ?? "pending"}`
          : response.task.output.pr_url
            ? ` — ${response.task.output.pr_url}`
            : ""
      }`,
    );

    if (isTerminalTaskStatus(response.task.status)) {
      return {
        exitCode: exitForWatchTaskStatus(response.task.status),
        response,
      };
    }

    if (Date.now() - startedAt >= options.timeoutMs) {
      logProgress("Watch timed out before the task reached a terminal state.");
      return { exitCode: CLI_EXIT.timeout, response };
    }

    const elapsed = Date.now() - startedAt;
    const remaining = options.timeoutMs - elapsed;
    const nextSleep = Math.min(options.intervalMs, remaining);

    try {
      await sleep(nextSleep, options.signal);
    } catch (error) {
      if (error instanceof CliAbortError) {
        throw error;
      }

      return { exitCode: CLI_EXIT.network };
    }
  }
};

export const emitStatusOutput = (
  context: CliContext,
  response: NonNullable<StatusCommandResult["response"]>,
) => {
  if (context.outputMode === "json") {
    writeJson(response);
    return;
  }

  logProgress(formatTaskOutcomeHuman(response.task));
};
