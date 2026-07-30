import {
  OUTCOMES_API_DEFAULT_BASE_URL,
  OUTCOMES_API_PATHS,
  acceptQuoteInputSchema,
  acceptQuoteResponseSchema,
  apiErrorBodySchema,
  createAssessmentInputSchema,
  createAssessmentResponseSchema,
  createQuoteInputSchema,
  createQuoteResponseSchema,
  getTaskResponseSchema,
  listInstallationsResponseSchema,
  repositoryCaptureRequestSchema,
  repositoryCaptureResponseSchema,
  type AcceptQuoteInput,
  type CreateAssessmentInput,
  type CreateQuoteInput,
  type RepositoryCaptureRequest,
} from "@outcomes/contracts";
import type { z } from "zod";

import { OutcomesClientError } from "./errors.js";

export type OutcomesClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

type RequestOptions<TSchema extends z.ZodTypeAny> = {
  acceptStatuses?: number[];
  body?: unknown;
  method: "GET" | "POST";
  path: string;
  responseSchema: TSchema;
  signal?: AbortSignal;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export const assertAllowedBaseUrl = (baseUrl: string): string => {
  const normalized = baseUrl.replace(/\/+$/u, "");
  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new OutcomesClientError({
      code: "api_error",
      message: "OUTCOMES_API_BASE_URL must be a valid absolute URL.",
    });
  }

  if (parsed.protocol !== "https:" && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new OutcomesClientError({
      code: "api_error",
      message:
        "OUTCOMES_API_BASE_URL must use HTTPS except for loopback development hosts.",
    });
  }

  return normalized;
};

const normalizeBaseUrl = (baseUrl: string) => assertAllowedBaseUrl(baseUrl);

const isAbortError = (error: unknown): error is Error =>
  error instanceof Error && error.name === "AbortError";

export class OutcomesClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OutcomesClientOptions) {
    if (!options.apiKey.trim()) {
      throw new OutcomesClientError({
        code: "api_error",
        message: "An Outcomes API key is required.",
      });
    }

    this.apiKey = options.apiKey.trim();
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ?? OUTCOMES_API_DEFAULT_BASE_URL,
    );
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async listInstallations(signal?: AbortSignal) {
    return this.request({
      method: "GET",
      path: OUTCOMES_API_PATHS.installations,
      responseSchema: listInstallationsResponseSchema,
      signal,
    });
  }

  async captureRepositoryBinding(
    input: RepositoryCaptureRequest,
    signal?: AbortSignal,
  ) {
    const body = repositoryCaptureRequestSchema.parse(input);

    return this.request({
      body,
      method: "POST",
      path: OUTCOMES_API_PATHS.repositoryBindings,
      responseSchema: repositoryCaptureResponseSchema,
      signal,
    });
  }

  async createAssessment(input: CreateAssessmentInput, signal?: AbortSignal) {
    const body = createAssessmentInputSchema.parse(input);

    return this.request({
      body,
      method: "POST",
      path: OUTCOMES_API_PATHS.assessments,
      responseSchema: createAssessmentResponseSchema,
      signal,
    });
  }

  async createQuote(input: CreateQuoteInput, signal?: AbortSignal) {
    const body = createQuoteInputSchema.parse(input);

    return this.request({
      acceptStatuses: [201, 200, 422],
      body,
      method: "POST",
      path: OUTCOMES_API_PATHS.quotes,
      responseSchema: createQuoteResponseSchema,
      signal,
    });
  }

  async acceptQuote(
    quoteId: string,
    input: AcceptQuoteInput,
    signal?: AbortSignal,
  ) {
    const body = acceptQuoteInputSchema.parse(input);

    return this.request({
      acceptStatuses: [202],
      body,
      method: "POST",
      path: OUTCOMES_API_PATHS.acceptQuote(quoteId),
      responseSchema: acceptQuoteResponseSchema,
      signal,
    });
  }

  async getTaskStatus(taskId: string, signal?: AbortSignal) {
    return this.request({
      method: "GET",
      path: OUTCOMES_API_PATHS.task(taskId),
      responseSchema: getTaskResponseSchema,
      signal,
    });
  }

  async verifyAuth(signal?: AbortSignal) {
    return this.listInstallations(signal);
  }

  private throwForAbortError(
    error: unknown,
    signal: AbortSignal | undefined,
  ): never {
    if (isAbortError(error)) {
      if (signal?.aborted) {
        throw new OutcomesClientError({
          cause: error,
          code: "abort",
          message: "The Outcomes request was aborted.",
        });
      }

      throw new OutcomesClientError({
        cause: error,
        code: "timeout",
        message: "The Outcomes request timed out.",
      });
    }

    throw new OutcomesClientError({
      cause: error,
      code: "network",
      message: "The Outcomes request could not reach the server.",
    });
  }

  private async request<TSchema extends z.ZodTypeAny>({
    acceptStatuses,
    body,
    method,
    path,
    responseSchema,
    signal,
  }: RequestOptions<TSchema>): Promise<z.infer<TSchema>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let externalAbortHandler: (() => void) | undefined;

    try {
      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          externalAbortHandler = () => {
            controller.abort();
          };
          signal.addEventListener("abort", externalAbortHandler);
        }
      }

      let response: Response;

      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          body: body === undefined ? undefined : JSON.stringify(body),
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          method,
          signal: controller.signal,
        });
      } catch (error) {
        this.throwForAbortError(error, signal);
      }

      let payload: unknown;

      try {
        payload = await response.json();
      } catch (error) {
        if (isAbortError(error)) {
          this.throwForAbortError(error, signal);
        }

        throw new OutcomesClientError({
          cause: error,
          code: "invalid_response",
          httpStatus: response.status,
          message: "The Outcomes response was not valid JSON.",
        });
      }

      const allowedStatuses = acceptStatuses ?? [200, 201, 202];

      if (!allowedStatuses.includes(response.status)) {
        const parsedError = apiErrorBodySchema.safeParse(payload);

        if (parsedError.success) {
          throw new OutcomesClientError({
            apiCode: parsedError.data.error.code,
            code: "api_error",
            details: parsedError.data.error.details,
            httpStatus: response.status,
            message: parsedError.data.error.message,
          });
        }

        throw new OutcomesClientError({
          code: "api_error",
          httpStatus: response.status,
          message: "The Outcomes request failed.",
        });
      }

      const parsed = responseSchema.safeParse(payload);

      if (!parsed.success) {
        throw new OutcomesClientError({
          code: "invalid_response",
          details: parsed.error.flatten(),
          httpStatus: response.status,
          message: "The Outcomes response did not match the expected contract.",
        });
      }

      return parsed.data;
    } finally {
      clearTimeout(timeoutId);

      if (signal && externalAbortHandler) {
        signal.removeEventListener("abort", externalAbortHandler);
      }
    }
  }
}
