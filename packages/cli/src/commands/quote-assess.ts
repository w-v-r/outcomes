import { OutcomesClientError } from "@outcomes/client";

import type { CliContext } from "../context.js";
import {
  assessOperationScope,
  fingerprintAssessmentRequest,
} from "../operations/idempotency.js";
import { mapClientErrorToExit, CLI_EXIT } from "../exit-mapping.js";
import { logInfo, writeJson, formatQuoteHuman } from "../output/format.js";
import { parseTaskInput, type TaskInputOptions } from "../task/parse-task-input.js";
import type { RepoInspectOptions } from "./repo-inspect.js";
import { captureBindingForDiscovery } from "./repo-inspect.js";
import { createBindingQuote } from "./quote-flow.js";

export const runAssess = async (
  context: CliContext,
  taskOptions: TaskInputOptions,
  repoOptions: RepoInspectOptions,
  signal?: AbortSignal,
): Promise<number> => {
  const task = parseTaskInput(taskOptions);
  const { bindingId } = await captureBindingForDiscovery(context, {
    ...repoOptions,
    requireRemoteSynced: true,
    signal,
  });
  const canonical = {
    repository_binding_id: bindingId,
    task,
  };
  const scope = assessOperationScope(bindingId, task);
  const bodyFingerprint = fingerprintAssessmentRequest(canonical);
  const idempotencyKey = context.state.resolveIdempotencyKey({
    bodyFingerprint,
    requestedOverride: context.options.idempotencyKey,
    scope,
  });
  const body = {
    ...canonical,
    idempotency_key: idempotencyKey,
  };

  try {
    const result = await context.client.createAssessment(body, signal);

    if (context.outputMode === "json") {
      writeJson(result);
      return result.assessment.decision === "decline" ||
        result.assessment.decision === "decompose"
        ? CLI_EXIT.rejected
        : CLI_EXIT.success;
    }

    logInfo(`Assessment ${result.assessment.id} (${result.assessment.decision})`);
    logInfo(
      `Range: ${(result.assessment.pricing.range.lowCents / 100).toFixed(2)}–${(result.assessment.pricing.range.highCents / 100).toFixed(2)} AUD`,
    );
    logInfo(
      `Execution eligible: ${result.assessment.execution_eligibility.eligible ? "yes" : "no"}`,
    );

    return result.assessment.decision === "decline" ||
      result.assessment.decision === "decompose"
      ? CLI_EXIT.rejected
      : CLI_EXIT.success;
  } catch (error) {
    if (error instanceof OutcomesClientError) {
      logInfo(error.message);
      return mapClientErrorToExit(error);
    }

    throw error;
  }
};

export const runQuote = async (
  context: CliContext,
  taskOptions: TaskInputOptions,
  repoOptions: RepoInspectOptions,
  signal?: AbortSignal,
): Promise<number> => {
  try {
    const { result } = await createBindingQuote(
      context,
      taskOptions,
      repoOptions,
      signal,
    );

    if (context.outputMode === "json") {
      writeJson(result);
      return result.quote.status === "rejected" ||
        result.quote.status === "expired"
        ? CLI_EXIT.rejected
        : CLI_EXIT.success;
    }

    logInfo(formatQuoteHuman(result.quote));

    return result.quote.status === "rejected" ||
      result.quote.status === "expired"
      ? CLI_EXIT.rejected
      : CLI_EXIT.success;
  } catch (error) {
    if (error instanceof OutcomesClientError) {
      logInfo(error.message);
      return mapClientErrorToExit(error);
    }

    throw error;
  }
};
