import { describe, expect, test } from "vitest";

import {
  createQuoteInputSchema,
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
});
