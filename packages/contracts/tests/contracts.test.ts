import { describe, expect, test } from "vitest";

import {
  createQuoteInputSchema,
  customerTaskExecutionSchema,
  normalizeGitHubRepositoryUrl,
  parseApiKey,
} from "../src/index.js";

describe("@outcomes/contracts", () => {
  test("normalizes SSH GitHub remotes", () => {
    expect(
      normalizeGitHubRepositoryUrl(
        "git@github.com:acme/example.git",
      ),
    ).toBe("https://github.com/acme/example");
  });

  test("parses API keys", () => {
    const value =
      "outcomes_test_aabbccddeeff_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    expect(parseApiKey(value)?.lookupPrefix).toBe("aabbccddeeff");
  });

  test("accepts binding-backed quote requests", () => {
    const parsed = createQuoteInputSchema.safeParse({
      idempotency_key: "quote-request-001",
      repository_binding_id: "33333333-3333-4333-8333-333333333333",
      task: {
        acceptanceCriteria: ["Tests pass."],
        description: "Fix the bug.",
        prohibitedChanges: ["Do not change auth."],
      },
    });

    expect(parsed.success).toBe(true);
  });

  test("defines a strict customer-safe execution status contract", () => {
    const execution = {
      claim_count: 2,
      completed_at: null,
      customer_error_code: "retry_scheduled",
      customer_error_message: "Temporary failure; retry scheduled.",
      failure_count: 1,
      id: "77777777-7777-4777-8777-777777777777",
      next_attempt_at: "2026-07-31T00:01:00.000Z",
      started_at: null,
      state: "retry_wait",
    };

    expect(customerTaskExecutionSchema.safeParse(execution).success).toBe(
      true,
    );
    expect(
      customerTaskExecutionSchema.safeParse({
        ...execution,
        internal_error: "secret provider detail",
      }).success,
    ).toBe(false);
  });
});
