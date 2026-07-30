import { readFileSync } from "node:fs";
import path from "node:path";

import {
  acceptQuoteInputSchema,
  bindingQuoteInputSchema,
  createAssessmentInputSchema,
  createAssessmentResponseSchema,
  createQuoteInputSchema,
  createQuoteResponseSchema,
  getTaskResponseSchema,
  listInstallationsResponseSchema,
  repositoryCaptureRequestSchema,
  repositoryCaptureResponseSchema,
} from "@outcomes/contracts";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("REST route contract imports", () => {
  test("route handlers import shared request schemas from contracts", () => {
    const schemasSource = readFileSync(
      path.join(repoRoot, "src/lib/control-plane/schemas.ts"),
      "utf8",
    );

    expect(schemasSource).toContain("@outcomes/contracts");
    expect(schemasSource).not.toContain("taskContractSchema = z");
  });

  test("shared schemas accept canonical request fixtures", () => {
    expect(
      repositoryCaptureRequestSchema.safeParse({
        base_branch: "main",
        base_sha: "0123456789abcdef0123456789abcdef01234567",
        repository_url: "https://github.com/acme/example",
        stored_installation_id: "22222222-2222-4222-8222-222222222222",
      }).success,
    ).toBe(true);

    expect(
      createAssessmentInputSchema.safeParse({
        idempotency_key: "assessment-request-001",
        repository_binding_id: "33333333-3333-4333-8333-333333333333",
        task: {
          acceptanceCriteria: ["ok"],
          description: "Fix",
          prohibitedChanges: ["none"],
        },
      }).success,
    ).toBe(true);

    expect(
      bindingQuoteInputSchema.safeParse({
        idempotency_key: "quote-request-001",
        repository_binding_id: "33333333-3333-4333-8333-333333333333",
        task: {
          acceptanceCriteria: ["ok"],
          description: "Fix",
          prohibitedChanges: ["none"],
        },
      }).success,
    ).toBe(true);

    expect(
      acceptQuoteInputSchema.safeParse({
        contract_hash: "a".repeat(64),
        idempotency_key: "customer-acceptance-001",
      }).success,
    ).toBe(true);
  });

  test("shared response schemas validate customer-safe fixtures", () => {
    expect(
      listInstallationsResponseSchema.safeParse({ installations: [] }).success,
    ).toBe(true);

    expect(
      createQuoteResponseSchema.safeParse({
        quote: {
          amount_cents: 1250,
          contract_hash: "a".repeat(64),
          currency: "AUD",
          eligibility: { code: "eligible", eligible: true },
          expires_at: "2026-07-31T00:00:00.000Z",
          id: "11111111-1111-4111-8111-111111111111",
          pricing_model_version: "2.0.0",
          replayed: false,
          repository_sha: "0123456789abcdef0123456789abcdef01234567",
          repository_url: "https://github.com/acme/example",
          status: "pending",
          task: {
            acceptanceCriteria: ["ok"],
            description: "Fix",
            prohibitedChanges: ["none"],
          },
          task_id: null,
          terms: "Terms",
        },
      }).success,
    ).toBe(true);

    expect(
      getTaskResponseSchema.safeParse({
        task: {
          agent_id: null,
          completed_at: null,
          created_at: "2026-07-31T00:00:00.000Z",
          execution: null,
          failure: null,
          id: "44444444-4444-4444-8444-444444444444",
          output: { branch: null, pr_url: null, ref: null },
          payment: null,
          quote_id: "11111111-1111-4111-8111-111111111111",
          repository_sha: "0123456789abcdef0123456789abcdef01234567",
          repository_url: "https://github.com/acme/example",
          run_id: null,
          started_at: null,
          status: "executing",
          task: {
            acceptanceCriteria: ["ok"],
            description: "Fix",
            prohibitedChanges: ["none"],
          },
          timeline: [],
          updated_at: "2026-07-31T00:00:00.000Z",
          usage: null,
          verified_at: null,
          verifier: {
            conclusion: null,
            evidence: null,
            run_id: null,
            status: null,
          },
          worker_model: null,
        },
      }).success,
    ).toBe(true);

    expect(
      repositoryCaptureResponseSchema.safeParse({
        binding: {
          base_branch: "main",
          base_sha: "0123456789abcdef0123456789abcdef01234567",
          id: "55555555-5555-4555-8555-555555555555",
          manifest_hash: "b".repeat(64),
          repository: {
            full_name: "acme/example",
            github_repository_id: 1,
            url: "https://github.com/acme/example",
            visibility: "private",
          },
          snapshot_id: "66666666-6666-4666-8666-666666666666",
        },
      }).success,
    ).toBe(true);

    expect(
      createAssessmentResponseSchema.safeParse({
        assessment: {
          accepted: false,
          confidence: "medium",
          created_at: "2026-07-31T00:00:00.000Z",
          decision: "accept",
          evidence_hash: "c".repeat(64),
          execution_eligibility: { code: "eligible", eligible: true },
          id: "77777777-7777-4777-8777-777777777777",
          pricing: {
            caveat:
              "Planning estimate from a deterministic, uncalibrated policy; not a delivery guarantee.",
            confidence: "medium",
            estimator: { id: "est", version: "1" },
            estimatorDecision: "accept",
            executionConditions: [],
            factors: ["bounded task"],
            policyVersion: "2.0.0",
            range: { currency: "AUD", highCents: 2000, lowCents: 1000 },
          },
          pricing_evidence_hash: "d".repeat(64),
          replayed: false,
          repository: {
            base_branch: "main",
            base_sha: "0123456789abcdef0123456789abcdef01234567",
            binding_id: "55555555-5555-4555-8555-555555555555",
            full_name: "acme/example",
            manifest_hash: "b".repeat(64),
            snapshot_id: "66666666-6666-4666-8666-666666666666",
            url: "https://github.com/acme/example",
          },
          source: null,
          task: {
            acceptanceCriteria: ["ok"],
            description: "Fix",
            prohibitedChanges: ["none"],
          },
        },
      }).success,
    ).toBe(true);
  });

  test("legacy URL quote remains part of union for fixture compatibility", () => {
    expect(
      createQuoteInputSchema.safeParse({
        idempotency_key: "legacy-quote-001",
        repository_sha: "0123456789abcdef0123456789abcdef01234567",
        repository_url: "https://github.com/acme/example",
        task: {
          acceptanceCriteria: ["ok"],
          description: "Fix",
          prohibitedChanges: ["none"],
        },
      }).success,
    ).toBe(true);
  });
});
