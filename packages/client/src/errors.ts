export type OutcomesClientErrorCode =
  | "abort"
  | "api_error"
  | "invalid_response"
  | "network"
  | "timeout";

export class OutcomesClientError extends Error {
  readonly apiCode: string | undefined;
  readonly causeError: unknown;
  readonly code: OutcomesClientErrorCode;
  readonly details: unknown;
  readonly httpStatus: number | undefined;

  constructor({
    apiCode,
    cause,
    code,
    details,
    httpStatus,
    message,
  }: {
    apiCode?: string;
    cause?: unknown;
    code: OutcomesClientErrorCode;
    details?: unknown;
    httpStatus?: number;
    message: string;
  }) {
    super(message);
    this.name = "OutcomesClientError";
    this.code = code;
    this.apiCode = apiCode;
    this.httpStatus = httpStatus;
    this.details = details;
    this.causeError = cause;
  }
}
