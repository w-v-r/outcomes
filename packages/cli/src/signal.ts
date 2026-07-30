import { CLI_EXIT } from "@outcomes/contracts";

export type InterruptedSignal = "SIGINT" | "SIGTERM";

export class CliAbortError extends Error {
  constructor(message = "The Outcomes CLI operation was aborted.") {
    super(message);
    this.name = "CliAbortError";
  }
}

export const resolveInterruptedExitCode = (
  interruptedSignal: InterruptedSignal | null,
): number =>
  interruptedSignal === "SIGTERM" ? CLI_EXIT.terminated : CLI_EXIT.signal;

export const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new CliAbortError();
  }
};
