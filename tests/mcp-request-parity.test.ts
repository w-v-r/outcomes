import { readFileSync } from "node:fs";
import path from "node:path";

import {
  acceptQuoteInputSchema,
  bindingQuoteInputShape,
  bindingQuoteInputSchema,
} from "@outcomes/contracts";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("MCP request parity", () => {
  test("MCP quote_task uses the same binding-backed quote schema as REST", () => {
    const mcpSource = readFileSync(
      path.join(repoRoot, "src/app/api/mcp/route.ts"),
      "utf8",
    );

    expect(mcpSource).toContain("bindingQuoteInputShape");
    expect(mcpSource).not.toContain("legacyQuoteInputSchema");

    const sample = {
      idempotency_key: "quote-request-001",
      repository_binding_id: "33333333-3333-4333-8333-333333333333",
      task: {
        acceptanceCriteria: ["ok"],
        description: "Fix",
        prohibitedChanges: ["none"],
      },
    };

    expect(bindingQuoteInputSchema.safeParse(sample).success).toBe(true);
    expect(
      bindingQuoteInputShape.idempotency_key.safeParse(sample.idempotency_key)
        .success,
    ).toBe(true);
  });

  test("MCP accept_quote_and_start matches REST accept body fields", () => {
    const mcpSource = readFileSync(
      path.join(repoRoot, "src/app/api/mcp/route.ts"),
      "utf8",
    );

    expect(mcpSource).toContain("acceptQuoteInputSchema.shape.contract_hash");
    expect(mcpSource).toContain("quote_id");

    expect(
      acceptQuoteInputSchema.safeParse({
        contract_hash: "a".repeat(64),
        idempotency_key: "customer-acceptance-001",
      }).success,
    ).toBe(true);
  });
});
