import { z } from "zod";

export const apiErrorBodySchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        details: z.unknown().optional(),
        message: z.string(),
      })
      .strict(),
  })
  .strict();

export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

export const COMMON_API_ERROR_CODES = [
  "auth_unavailable",
  "billing_not_ready",
  "database_error",
  "idempotency_conflict",
  "invalid_api_key",
  "invalid_json",
  "invalid_quote_id",
  "invalid_request",
  "invalid_task_id",
  "internal_error",
  "missing_api_key",
  "quote_not_acceptable",
  "quote_not_found",
  "repository_access_denied",
  "repository_capture_failed",
  "repository_installation_not_found",
  "repository_preflight_failed",
  "service_unavailable",
  "task_not_found",
  "worker_start_failed",
] as const;

export const TERMINAL_TASK_STATUSES = [
  "cancelled",
  "completed",
  "failed",
  "payment_failed",
  "verification_failed",
  "worker_failed",
] as const;

export type TerminalTaskStatus = (typeof TERMINAL_TASK_STATUSES)[number];

export const isTerminalTaskStatus = (
  status: string,
): status is TerminalTaskStatus =>
  (TERMINAL_TASK_STATUSES as readonly string[]).includes(status);

export const QUOTE_CUSTOMER_STATUSES = [
  "accepted",
  "expired",
  "pending",
  "rejected",
] as const;

export type QuoteCustomerStatus = (typeof QUOTE_CUSTOMER_STATUSES)[number];

export const CLI_EXIT = {
  success: 0,
  usage: 1,
  auth: 2,
  repository: 3,
  rejected: 4,
  declined: 5,
  worker: 6,
  verification: 7,
  payment: 8,
  network: 9,
  internal: 10,
  timeout: 11,
  signal: 130,
  terminated: 143,
} as const;

export type CliExitCode = (typeof CLI_EXIT)[keyof typeof CLI_EXIT];

export const exitCodeForTaskStatus = (status: string): CliExitCode => {
  if (status === "completed") {
    return CLI_EXIT.success;
  }

  if (status === "worker_failed" || status === "failed") {
    return CLI_EXIT.worker;
  }

  if (status === "verification_failed") {
    return CLI_EXIT.verification;
  }

  if (status === "payment_failed") {
    return CLI_EXIT.payment;
  }

  if (status === "cancelled") {
    return CLI_EXIT.rejected;
  }

  return CLI_EXIT.internal;
};

/** One-shot status query succeeded; non-terminal tasks are not errors. */
export const exitCodeForStatusQuery = (): CliExitCode => CLI_EXIT.success;

export const exitCodeForQuoteStatus = (
  status: QuoteCustomerStatus,
): CliExitCode =>
  status === "rejected" || status === "expired"
    ? CLI_EXIT.rejected
    : CLI_EXIT.success;

export const mapApiErrorToCliExit = (input: {
  apiCode?: string;
  httpStatus?: number;
}): CliExitCode => {
  const { apiCode, httpStatus } = input;

  if (
    httpStatus === 401 ||
    apiCode === "missing_api_key" ||
    apiCode === "invalid_api_key" ||
    apiCode === "auth_unavailable"
  ) {
    return CLI_EXIT.auth;
  }

  if (
    apiCode === "repository_access_denied" ||
    apiCode === "repository_installation_not_found" ||
    apiCode === "repository_preflight_failed" ||
    apiCode === "repository_capture_failed"
  ) {
    return CLI_EXIT.repository;
  }

  if (
    apiCode === "billing_not_ready" ||
    apiCode === "quote_not_acceptable" ||
    apiCode === "idempotency_conflict"
  ) {
    return CLI_EXIT.rejected;
  }

  if (apiCode === "quote_not_found" || apiCode === "task_not_found") {
    return CLI_EXIT.rejected;
  }

  if (httpStatus === 403) {
    return CLI_EXIT.repository;
  }

  if (httpStatus === 404 && apiCode?.startsWith("repository")) {
    return CLI_EXIT.repository;
  }

  return CLI_EXIT.internal;
};
