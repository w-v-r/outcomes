import type { TaskContract } from "@outcomes/contracts";

import { fingerprintJson } from "../config/state.js";

export const fingerprintTask = (task: TaskContract): string =>
  fingerprintJson(task);

export const quoteOperationScope = (
  bindingId: string,
  task: TaskContract,
): string => `quote:${bindingId}:${fingerprintTask(task)}`;

export const assessOperationScope = (
  bindingId: string,
  task: TaskContract,
): string => `assess:${bindingId}:${fingerprintTask(task)}`;

/** Canonical request body fingerprint excludes generated idempotency_key. */
export const fingerprintQuoteRequest = (input: {
  repository_binding_id: string;
  task: TaskContract;
}): string => fingerprintJson(input);

export const fingerprintAssessmentRequest = (input: {
  repository_binding_id: string;
  task: TaskContract;
}): string => fingerprintJson(input);

export const fingerprintAcceptRequest = (input: {
  contract_hash: string;
  quote_id: string;
}): string => fingerprintJson(input);
