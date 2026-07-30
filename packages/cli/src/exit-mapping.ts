import { OutcomesClientError } from "@outcomes/client";
import {
  CLI_EXIT,
  exitCodeForQuoteStatus,
  exitCodeForStatusQuery,
  exitCodeForTaskStatus,
  mapApiErrorToCliExit,
  type QuoteCustomerStatus,
} from "@outcomes/contracts";

import { RepositoryDiscoveryError } from "./git/discovery.js";
import { CliAbortError } from "./signal.js";

export const mapClientErrorToExit = (error: unknown): number => {
  if (error instanceof OutcomesClientError) {
    if (error.code === "abort") {
      throw new CliAbortError();
    }

    if (error.code === "timeout") {
      return CLI_EXIT.timeout;
    }

    if (error.code === "network") {
      return CLI_EXIT.network;
    }

    if (error.code === "invalid_response") {
      return CLI_EXIT.internal;
    }

    return mapApiErrorToCliExit({
      apiCode: error.apiCode,
      httpStatus: error.httpStatus,
    });
  }

  if (error instanceof RepositoryDiscoveryError) {
    return CLI_EXIT.repository;
  }

  if (!(error instanceof Error)) {
    return CLI_EXIT.internal;
  }

  if (error.message.includes("OUTCOMES_API_KEY")) {
    return CLI_EXIT.auth;
  }

  if (error.message.includes("Interactive approval requires")) {
    return CLI_EXIT.declined;
  }

  if (
    error.message.includes("state file") ||
    error.message.includes("State store")
  ) {
    return CLI_EXIT.internal;
  }

  return CLI_EXIT.internal;
};

export const exitForQuoteStatus = (status: QuoteCustomerStatus): number =>
  exitCodeForQuoteStatus(status);

export const exitForWatchTaskStatus = (status: string): number =>
  exitCodeForTaskStatus(status);

export const exitForStatusQuery = (): number => exitCodeForStatusQuery();

export { CLI_EXIT };
