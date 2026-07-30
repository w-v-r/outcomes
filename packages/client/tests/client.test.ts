import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";

import { CLI_EXIT, exitCodeForQuoteStatus } from "@outcomes/contracts";
import { describe, expect, test, vi } from "vitest";

import { OutcomesClient, OutcomesClientError, assertAllowedBaseUrl } from "../src/index.js";

const rejectedQuoteBody = {
  quote: {
    amount_cents: 1250,
    contract_hash: "a".repeat(64),
    currency: "AUD" as const,
    eligibility: {
      code: "task_not_allowed",
      eligible: false,
      reason: "Fixture only",
    },
    expires_at: "2026-07-31T00:00:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
    pricing_model_version: "1.0.0",
    replayed: false,
    repository_sha: "4aff18a256039f727b54d3cc48b65e8e8eab7bb7",
    repository_url: "https://github.com/w-v-r/agent-cost-benchmark-fixture",
    status: "rejected" as const,
    task: {
      acceptanceCriteria: ["Tests pass."],
      description: "Fix it",
      prohibitedChanges: ["No tests"],
    },
    task_id: null,
    terms: "Rejected",
  },
};

const startServer = (
  handler: (request: IncomingMessage) => {
    body: unknown;
    status: number;
  },
) =>
  new Promise<{
    baseUrl: string;
    close: () => Promise<void>;
  }>((resolve) => {
    const server = createServer((request, response) => {
      const result = handler(request);
      response.writeHead(result.status, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify(result.body));
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Server failed to bind.");
      }

      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) =>
              error ? closeReject(error) : closeResolve(),
            );
          }),
      });
    });
  });

describe("@outcomes/client", () => {
  test("sends Authorization and parses installations", async () => {
    let seenAuth = "";

    const server = await startServer((request) => {
      seenAuth = request.headers.authorization ?? "";

      return {
        body: {
          installations: [
            {
              account: { login: "acme", type: "Organization" },
              created_at: "2026-07-31T00:00:00.000Z",
              installation_generation_id:
                "22222222-2222-4222-8222-222222222222",
              repository_selection: "selected",
              status: "active",
            },
          ],
        },
        status: 200,
      };
    });

    const client = new OutcomesClient({
      apiKey:
        "outcomes_test_aabbccddeeff_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      baseUrl: server.baseUrl,
    });

    const result = await client.listInstallations();

    expect(result.installations).toHaveLength(1);
    expect(seenAuth).toMatch(/^Bearer outcomes_test_/u);
    await server.close();
  });

  test("maps API errors to OutcomesClientError", async () => {
    const server = await startServer(() => ({
      body: {
        error: {
          code: "billing_not_ready",
          message: "Complete billing setup.",
        },
      },
      status: 409,
    }));

    const client = new OutcomesClient({
      apiKey:
        "outcomes_test_aabbccddeeff_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      baseUrl: server.baseUrl,
    });

    await expect(client.listInstallations()).rejects.toBeInstanceOf(
      OutcomesClientError,
    );
    await server.close();
  });

  test("parses persisted rejected quotes returned with HTTP 422", async () => {
    const server = await startServer(() => ({
      body: rejectedQuoteBody,
      status: 422,
    }));

    const client = new OutcomesClient({
      apiKey:
        "outcomes_test_aabbccddeeff_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      baseUrl: server.baseUrl,
    });

    const result = await client.createQuote({
      idempotency_key: "quote-request-001",
      repository_binding_id: "33333333-3333-4333-8333-333333333333",
      task: rejectedQuoteBody.quote.task,
    });

    expect(result.quote.status).toBe("rejected");
    expect(exitCodeForQuoteStatus(result.quote.status)).toBe(CLI_EXIT.rejected);
    await server.close();
  });

  test("rejects non-HTTPS origins except loopback", () => {
    expect(() => assertAllowedBaseUrl("http://example.com")).toThrow(
      /HTTPS/u,
    );
    expect(assertAllowedBaseUrl("http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000",
    );
  });

  test("classifies external abort during JSON body read as abort", async () => {
    const external = new AbortController();
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => ({
      status: 200,
      json: async () => {
        external.abort();
        await Promise.resolve();

        if (init?.signal?.aborted) {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          throw error;
        }

        return { installations: [] };
      },
    }));

    const client = new OutcomesClient({
      apiKey:
        "outcomes_test_aabbccddeeff_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      baseUrl: "http://127.0.0.1:9",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.listInstallations(external.signal)).rejects.toMatchObject(
      { code: "abort" },
    );
  });

  test("classifies timeout during JSON body read as timeout", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      json: async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 40);
        });
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        throw error;
      },
    }));

    const client = new OutcomesClient({
      apiKey:
        "outcomes_test_aabbccddeeff_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      baseUrl: "http://127.0.0.1:9",
      fetch: fetchImpl as unknown as typeof fetch,
      timeoutMs: 5,
    });

    await expect(client.listInstallations()).rejects.toMatchObject({
      code: "timeout",
    });
  });
});
