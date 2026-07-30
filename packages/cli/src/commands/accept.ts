import { createInterface } from "node:readline/promises";

import { OutcomesClientError } from "@outcomes/client";
import type { AcceptQuoteInput } from "@outcomes/contracts";

import type { CliContext } from "../context.js";
import { mapClientErrorToExit, CLI_EXIT } from "../exit-mapping.js";
import { fingerprintAcceptRequest } from "../operations/idempotency.js";
import { logInfo, writeJson, writeJsonCliEnvelope } from "../output/format.js";
import { requireInteractiveApproval } from "../tty.js";

export type AcceptOptions = {
  contractHash?: string;
  emitOutput?: boolean;
  idempotencyKey?: string;
  quoteId: string;
  signal?: AbortSignal;
  yes?: boolean;
};

export type AcceptCommandResult = {
  exitCode: number;
  response?: Awaited<
    ReturnType<CliContext["client"]["acceptQuote"]>
  >;
};

export const runAccept = async (
  context: CliContext,
  options: AcceptOptions,
): Promise<AcceptCommandResult> => {
  if (!options.contractHash) {
    logInfo("Acceptance requires --contract-hash from the quote response.");
    return { exitCode: CLI_EXIT.usage };
  }

  const scope = `accept:${options.quoteId}`;
  const bodyFingerprint = fingerprintAcceptRequest({
    contract_hash: options.contractHash,
    quote_id: options.quoteId,
  });
  const idempotencyKey = context.state.resolveIdempotencyKey({
    bodyFingerprint,
    requestedOverride:
      options.idempotencyKey ?? context.options.idempotencyKey,
    scope,
  });

  if (!options.yes) {
    try {
      requireInteractiveApproval();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Approval refused.";
      logInfo(message);

      if (context.outputMode === "json") {
        writeJsonCliEnvelope({
          error: { code: "declined", message },
        });
      }

      return { exitCode: CLI_EXIT.declined };
    }

    const readline = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    const answer = (
      await readline.question(
        "Accept this exact quote and start work? [y/N] ",
      )
    )
      .trim()
      .toLowerCase();
    readline.close();

    if (answer !== "y" && answer !== "yes") {
      logInfo("Approval declined.");
      return { exitCode: CLI_EXIT.declined };
    }
  }

  const requestBody: AcceptQuoteInput = {
    contract_hash: options.contractHash,
    idempotency_key: idempotencyKey,
  };

  try {
    const response = await context.client.acceptQuote(
      options.quoteId,
      requestBody,
      options.signal,
    );

    context.state.putTask(scope, response.task.task_id, options.quoteId);

    if (options.emitOutput !== false) {
      if (context.outputMode === "json") {
        writeJson(response);
      } else {
        logInfo(`Task ${response.task.task_id} (${response.task.status})`);
      }
    }

    return { exitCode: CLI_EXIT.success, response };
  } catch (error) {
    if (error instanceof OutcomesClientError) {
      logInfo(error.message);
      return { exitCode: mapClientErrorToExit(error) };
    }

    throw error;
  }
};
