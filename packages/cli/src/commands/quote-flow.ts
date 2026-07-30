import type { BindingQuoteInput, CreateQuoteInput } from "@outcomes/contracts";
import { OutcomesClientError } from "@outcomes/client";

import type { CliContext } from "../context.js";
import {
  fingerprintQuoteRequest,
  quoteOperationScope,
} from "../operations/idempotency.js";
import { parseTaskInput, type TaskInputOptions } from "../task/parse-task-input.js";
import {
  captureBindingForDiscovery,
  type RepoInspectOptions,
} from "./repo-inspect.js";

export const createBindingQuote = async (
  context: CliContext,
  taskOptions: TaskInputOptions,
  repoOptions: RepoInspectOptions,
  signal?: AbortSignal,
) => {
  const task = parseTaskInput(taskOptions);
  const { bindingId } = await captureBindingForDiscovery(context, {
    ...repoOptions,
    requireRemoteSynced: true,
    signal,
  });
  const canonical = {
    repository_binding_id: bindingId,
    task,
  } satisfies Omit<BindingQuoteInput, "idempotency_key">;
  const scope = quoteOperationScope(bindingId, task);
  const bodyFingerprint = fingerprintQuoteRequest(canonical);
  const idempotencyKey = context.state.resolveIdempotencyKey({
    bodyFingerprint,
    requestedOverride: context.options.idempotencyKey,
    scope,
  });
  const body: CreateQuoteInput = {
    ...canonical,
    idempotency_key: idempotencyKey,
  };

  try {
    const result = await context.client.createQuote(body, signal);
    return { bindingId, result, scope, task };
  } catch (error) {
    if (error instanceof OutcomesClientError) {
      throw error;
    }

    throw error;
  }
};
