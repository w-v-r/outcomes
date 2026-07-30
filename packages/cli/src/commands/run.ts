import { createInterface } from "node:readline/promises";

import { OutcomesClientError } from "@outcomes/client";
import { CLI_EXIT } from "@outcomes/contracts";

import type { CliContext } from "../context.js";
import { mapClientErrorToExit } from "../exit-mapping.js";
import {
  formatQuoteHuman,
  logInfo,
  writeJson,
  writeJsonCliEnvelope,
} from "../output/format.js";
import type { TaskInputOptions } from "../task/parse-task-input.js";
import { isInteractiveInput, requireInteractiveApproval } from "../tty.js";
import { CliAbortError } from "../signal.js";
import { runAccept } from "./accept.js";
import { createBindingQuote } from "./quote-flow.js";
import type { RepoInspectOptions } from "./repo-inspect.js";
import { emitStatusOutput, runStatus } from "./status.js";

export type RunOptions = TaskInputOptions &
  RepoInspectOptions & {
    contractHash?: string;
    signal?: AbortSignal;
    watchIntervalMs: number;
    watchTimeoutMs: number;
    yes?: boolean;
  };

export const runRun = async (
  context: CliContext,
  options: RunOptions,
): Promise<number> => {
  try {
    const { result: quoteResult } = await createBindingQuote(
      context,
      options,
      options,
      options.signal,
    );
    const quote = quoteResult.quote;

    if (quote.status === "rejected" || quote.status === "expired") {
      if (context.outputMode === "json") {
        writeJson({ quote: quoteResult.quote });
      } else {
        logInfo(formatQuoteHuman(quote));
      }

      return CLI_EXIT.rejected;
    }

    if (options.yes) {
      if (!options.contractHash) {
        const message =
          "Non-interactive run requires --yes and --contract-hash.";

        logInfo(message);

        if (context.outputMode === "json") {
          writeJsonCliEnvelope({
            error: { code: "usage", message },
            quote: quoteResult,
          });
        }

        return CLI_EXIT.usage;
      }

      if (options.contractHash !== quote.contract_hash) {
        const message =
          "Supplied --contract-hash does not match the returned quote contract hash.";

        logInfo(message);

        if (context.outputMode === "json") {
          writeJsonCliEnvelope({
            error: { code: "declined", message },
            quote: quoteResult,
          });
        }

        return CLI_EXIT.declined;
      }
    } else {
      if (!isInteractiveInput()) {
        try {
          requireInteractiveApproval();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Approval refused.";
          logInfo(message);

          if (context.outputMode === "json") {
            writeJsonCliEnvelope({
              error: { code: "declined", message },
              quote: quoteResult,
            });
          } else {
            logInfo(formatQuoteHuman(quote));
          }

          return CLI_EXIT.declined;
        }
      }

      if (context.outputMode === "human") {
        logInfo(formatQuoteHuman(quote));
      }

      const readline = createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      const answer = (
        await readline.question(
          `Approve ${quote.contract_hash} and start work? [y/N] `,
        )
      )
        .trim()
        .toLowerCase();
      readline.close();

      if (answer !== "y" && answer !== "yes") {
        const message = "Approval declined.";
        logInfo(message);

        if (context.outputMode === "json") {
          writeJsonCliEnvelope({
            error: { code: "declined", message },
            quote: quoteResult,
          });
        }

        return CLI_EXIT.declined;
      }
    }

    const acceptResult = await runAccept(context, {
      contractHash: quote.contract_hash,
      emitOutput: false,
      quoteId: quote.id,
      signal: options.signal,
      yes: true,
    });

    if (acceptResult.exitCode !== CLI_EXIT.success || !acceptResult.response) {
      return acceptResult.exitCode;
    }

    const statusResult = await runStatus(context, {
      intervalMs: options.watchIntervalMs,
      signal: options.signal,
      taskId: acceptResult.response.task.task_id,
      timeoutMs: options.watchTimeoutMs,
      watch: true,
    });

    if (context.outputMode === "json") {
      writeJson({
        accept: acceptResult.response,
        quote: quoteResult,
        status: statusResult.response,
      });
    } else if (statusResult.response) {
      emitStatusOutput(context, statusResult.response);
    }

    return statusResult.exitCode;
  } catch (error) {
    if (error instanceof CliAbortError) {
      throw error;
    }

    if (error instanceof OutcomesClientError) {
      if (error.code === "abort") {
        throw new CliAbortError();
      }

      logInfo(error.message);
      return mapClientErrorToExit(error);
    }

    throw error;
  }
};
