import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  acceptQuoteInputSchema,
  bindingQuoteInputSchema,
  createAssessmentInputSchema,
} from "@outcomes/contracts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliSourceRoot = path.join(repoRoot, "packages/cli/src");

const forbiddenImportPatterns = [
  "@/lib/pricing",
  "@/lib/workers",
  "@/lib/verifiers",
  "@/lib/supabase",
  "server-only",
];

const collectSourceFiles = (directory: string): string[] => {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
};

describe("adapter contract drift guards", () => {
  test("CLI sources do not import server pricing/worker/supabase modules", () => {
    const files = collectSourceFiles(cliSourceRoot);

    for (const file of files) {
      const source = readFileSync(file, "utf8");

      for (const pattern of forbiddenImportPatterns) {
        expect(source.includes(pattern)).toBe(false);
      }
    }
  });

  test("REST route schemas re-export shared contracts", () => {
    const schemasSource = readFileSync(
      path.join(repoRoot, "src/lib/control-plane/schemas.ts"),
      "utf8",
    );

    expect(schemasSource).toContain("@outcomes/contracts");
    expect(schemasSource).toContain("bindingQuoteInputSchema");
    expect(schemasSource).toContain("createAssessmentInputSchema");
  });

  test("shared request schemas stay strict", () => {
    expect(
      bindingQuoteInputSchema.safeParse({
        idempotency_key: "short",
        repository_binding_id: "33333333-3333-4333-8333-333333333333",
        task: {
          acceptanceCriteria: ["ok"],
          description: "Fix it",
          prohibitedChanges: ["none"],
        },
      }).success,
    ).toBe(false);

    expect(
      createAssessmentInputSchema.safeParse({
        idempotency_key: "assessment-request-001",
        repository_binding_id: "33333333-3333-4333-8333-333333333333",
        task: {
          acceptanceCriteria: ["ok"],
          description: "Fix it",
          prohibitedChanges: ["none"],
        },
      }).success,
    ).toBe(true);

    expect(
      acceptQuoteInputSchema.safeParse({
        contract_hash: "abc",
        idempotency_key: "customer-acceptance-001",
      }).success,
    ).toBe(false);
  });
});
