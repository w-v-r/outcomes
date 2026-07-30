import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
  createAssessTaskService,
  evaluateSnapshotTask,
  type AssessmentRow,
  type AssessmentStore,
} from "@/lib/control-plane/assessments";
import { requireAcceptedTaskId } from "@/lib/control-plane/acceptance-result";
import { ControlPlaneError } from "@/lib/control-plane/errors";
import { createInternalTaskAnalysisId } from "@/lib/control-plane/internal-task-id";
import {
  bindingQuoteInputShape,
  createAssessmentInputSchema,
  repositoryCaptureRequestSchema,
} from "@/lib/control-plane/schemas";
import {
  createSnapshotQuoteService,
  type SnapshotQuoteRow,
  type SnapshotQuoteStore,
} from "@/lib/control-plane/snapshot-quotes";
import { type TaskContract } from "@/lib/pricing/domain";
import { createContractHash } from "@/lib/pricing/quote-policy";
import {
  FIXTURE_MANIFEST,
  FIXTURE_REPOSITORY,
  ZERO_DIVISION_TASK_CONTRACT,
} from "@/lib/pricing/registry";
import {
  ACCEPT_WITH_CONDITIONS_NOTICE,
  deriveSnapshotPricing,
} from "@/lib/pricing/snapshot-policy";
import {
  REPOSITORY_BINDING_SCHEMA_VERSION,
  REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
  calculateRepositoryManifestHash,
  parseRepositorySnapshot,
  repositoryBindingSchema,
} from "@/lib/repositories/domain";
import { createRepositoryApplicationService } from "@/lib/repositories/application";
import {
  RepositoryCaptureError,
  type RepositoryCaptureErrorCode,
} from "@/lib/repositories/capture";
import {
  createRepositoryEvidenceLoader,
  type OwnedRepositoryEvidence,
} from "@/lib/repositories/evidence";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => null,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "99999999-9999-4999-8999-999999999999";
const INSTALLATION_ID = "22222222-2222-4222-8222-222222222222";
const SMALL_BINDING_ID = "33333333-3333-4333-8333-333333333333";
const LARGE_BINDING_ID = "44444444-4444-4444-8444-444444444444";
const SMALL_SNAPSHOT_ID = "55555555-5555-4555-8555-555555555555";
const LARGE_SNAPSHOT_ID = "66666666-6666-4666-8666-666666666666";

const featureTask: TaskContract = {
  acceptanceCriteria: [
    "The payment retry state is persisted.",
    "The repository test suite passes.",
  ],
  description:
    "Implement bounded payment retry handling in packages/app/src/payment.ts.",
  prohibitedChanges: [
    "Do not change authentication.",
    "Do not add customer commands.",
  ],
};

const createManifest = ({
  commitSha,
  large,
  repositoryUrl,
}: {
  commitSha: string;
  large: boolean;
  repositoryUrl: string;
}) => {
  const addedFiles = large
    ? Array.from({ length: 40 }, (_, index) => ({
        approximateTokens: 2_000 + index * 10,
        bytes: 8_000 + index * 40,
        category: (index % 4 === 0 ? "test" : "source") as
          | "source"
          | "test",
        extension: ".ts",
        lines: 200,
        path:
          index === 0
            ? "packages/app/src/payment.ts"
            : `packages/app/src/module-${index}.ts`,
      }))
    : [];
  const files = [
    ...FIXTURE_MANIFEST.files,
    ...addedFiles,
  ];

  return {
    ...FIXTURE_MANIFEST,
    baselineSignals: {
      ...FIXTURE_MANIFEST.baselineSignals,
      isMonorepo: large,
    },
    files,
    oversizedFiles: large
      ? [
          {
            approximateTokens: 20_000,
            bytes: 80_000,
            path: "packages/app/src/legacy.ts",
          },
        ]
      : [],
    packages: large ? ["packages/app", "packages/shared"] : [],
    snapshot: {
      commitSha,
      dirty: false as const,
    },
    source: {
      kind: "github" as const,
      ref: commitSha,
      url: repositoryUrl,
    },
    testFiles: large
      ? addedFiles
          .filter(({ category }) => category === "test")
          .map(({ path: filePath }) => filePath)
      : FIXTURE_MANIFEST.testFiles,
    totals: {
      approximateTokens: files.reduce(
        (sum, file) => sum + file.approximateTokens,
        0,
      ),
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      files: files.length,
      lines: files.reduce((sum, file) => sum + file.lines, 0),
    },
  };
};

const createEvidence = ({
  bindingId,
  commitSha,
  large,
  repositoryUrl,
  snapshotId,
}: {
  bindingId: string;
  commitSha: string;
  large: boolean;
  repositoryUrl: string;
  snapshotId: string;
}): OwnedRepositoryEvidence => {
  const repositoryFullName = new URL(repositoryUrl).pathname.slice(1);
  const manifest = createManifest({
    commitSha,
    large,
    repositoryUrl,
  });
  const snapshot = parseRepositorySnapshot({
    commitSha,
    manifest,
    manifestHash: calculateRepositoryManifestHash(manifest),
    repository: {
      canonicalUrl: repositoryUrl,
      fullName: repositoryFullName,
      githubRepositoryId: large ? 200 : 100,
      visibility: "private",
    },
    scanner: {
      id: "test-scanner",
      version: "1.0.0",
    },
    schemaVersion: REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
    treeSha: large ? "d".repeat(40) : "c".repeat(40),
  });
  const binding = repositoryBindingSchema.parse({
    accessBinding: {
      githubInstallationId: 123,
      provider: "github_app",
      storedInstallationId: INSTALLATION_ID,
    },
    baseBranch: "main",
    baseSha: commitSha,
    manifestHash: snapshot.manifestHash,
    provider: "github",
    repository: snapshot.repository,
    schemaVersion: REPOSITORY_BINDING_SCHEMA_VERSION,
    snapshotId,
  });

  return {
    binding,
    bindingId,
    snapshot,
    snapshotId,
    userId: USER_ID,
  };
};

const smallEvidence = createEvidence({
  bindingId: SMALL_BINDING_ID,
  commitSha: FIXTURE_REPOSITORY.baselineSha,
  large: false,
  repositoryUrl: FIXTURE_REPOSITORY.url,
  snapshotId: SMALL_SNAPSHOT_ID,
});
const largeEvidence = createEvidence({
  bindingId: LARGE_BINDING_ID,
  commitSha: "b".repeat(40),
  large: true,
  repositoryUrl: "https://github.com/acme/commerce",
  snapshotId: LARGE_SNAPSHOT_ID,
});

const createMemoryAssessmentStore = (
  created = true,
): AssessmentStore & {
  rows: Map<string, AssessmentRow>;
} => {
  const rows = new Map<string, AssessmentRow>();

  return {
    findByRequest: async ({ requestId, userId }) =>
      rows.get(`${userId}:${requestId}`) ?? null,
    persist: async ({ assessment, requestId, userId }) => {
      const row: AssessmentRow = {
        ...assessment,
        created_at: "2026-07-31T00:00:00.000Z",
        id: "77777777-7777-4777-8777-777777777777",
      };
      rows.set(`${userId}:${requestId}`, row);
      return { created, row };
    },
    rows,
  };
};

const createMemoryQuoteStore = (
  created = true,
): SnapshotQuoteStore & {
  rows: Map<string, SnapshotQuoteRow>;
} => {
  const rows = new Map<string, SnapshotQuoteRow>();

  return {
    findByRequest: async ({ requestId, userId }) =>
      rows.get(`${userId}:${requestId}`) ?? null,
    persist: async ({ quote, userId }) => {
      const row: SnapshotQuoteRow = {
        ...quote,
        id: "88888888-8888-4888-8888-888888888888",
        task_id: null,
      };
      rows.set(`${userId}:${quote.request_id}`, row);
      return { created, row };
    },
    rows,
  };
};

describe("snapshot-backed assessment and pricing", () => {
  test("uses the persisted manifest and produces different evidence and ranges", async () => {
    const small = await evaluateSnapshotTask({
      evidence: smallEvidence,
      task: ZERO_DIVISION_TASK_CONTRACT,
      taskId: "small-task",
    });
    const large = await evaluateSnapshotTask({
      evidence: largeEvidence,
      task: featureTask,
      taskId: "large-task",
    });

    expect(small.analysis.likelyRelevantFiles[0]?.path).toContain(
      "calculator",
    );
    expect(large.analysis.likelyRelevantFiles[0]?.path).toBe(
      "packages/app/src/payment.ts",
    );
    expect(large.pricing.customer.range.highCents).toBeGreaterThan(
      small.pricing.customer.range.highCents,
    );
    expect(large.pricing.evidenceHash).not.toBe(
      small.pricing.evidenceHash,
    );
    expect(
      large.pricing.underwriting.fixedPriceCents,
    ).toBeGreaterThanOrEqual(
      Math.ceil(
        large.pricing.underwriting.internalBudgetUsd *
          1.55 *
          100,
      ),
    );
    expect(
      large.pricing.underwriting.workerExecutionBudgetUsd,
    ).toBeGreaterThanOrEqual(
      large.estimate.executionAllowance.softCostLimitUsd,
    );
  });

  test("assesses a non-allowlisted repository but keeps execution closed", async () => {
    const store = createMemoryAssessmentStore();
    const assessTask = createAssessTaskService({
      loadEvidence: async () => largeEvidence,
      store,
    });
    const assessment = await assessTask(
      { apiKeyId: "key", userId: USER_ID },
      {
        idempotency_key: "assessment-commerce-001",
        repository_binding_id: LARGE_BINDING_ID,
        task: featureTask,
      },
    );

    expect(assessment.decision).not.toBe("decline");
    expect(assessment.execution_eligibility).toMatchObject({
      code: "repository_not_allowed",
      eligible: false,
    });
    expect(assessment.accepted).toBe(false);
  });

  test("rejects unsafe and external-business-outcome work semantically", async () => {
    const store = createMemoryAssessmentStore();
    const assessTask = createAssessTaskService({
      loadEvidence: async () => largeEvidence,
      store,
    });
    const assessment = await assessTask(
      { apiKeyId: "key", userId: USER_ID },
      {
        idempotency_key: "assessment-business-001",
        repository_binding_id: LARGE_BINDING_ID,
        task: {
          ...featureTask,
          description:
            "Implement this change and guarantee a 20% revenue increase.",
        },
      },
    );

    expect(assessment.decision).toBe("decline");
    expect(assessment.execution_eligibility.eligible).toBe(false);
  });

  test("persists deterministic Linear source evidence and detects idempotency conflicts", async () => {
    const store = createMemoryAssessmentStore();
    const assessTask = createAssessTaskService({
      loadEvidence: async () => smallEvidence,
      store,
    });
    const input = createAssessmentInputSchema.parse({
      idempotency_key: "assessment-linear-001",
      repository_binding_id: SMALL_BINDING_ID,
      source: {
        content_sha256: "e".repeat(64),
        issue_id: "WIL-42",
        issue_url: "https://linear.app/outcomes/issue/WIL-42/example",
        project_id: "project-1",
        provider: "linear",
        team_id: "team-1",
        workspace_id: "workspace-1",
      },
      task: ZERO_DIVISION_TASK_CONTRACT,
    });
    const first = await assessTask(
      { apiKeyId: "key", userId: USER_ID },
      input,
    );
    const replay = await assessTask(
      { apiKeyId: "key", userId: USER_ID },
      input,
    );

    expect(first.source?.content_sha256).toBe("e".repeat(64));
    expect(first.pricing_evidence_hash).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(replay.replayed).toBe(true);
    await expect(
      assessTask(
        { apiKeyId: "key", userId: USER_ID },
        {
          ...input,
          source: {
            ...input.source!,
            content_sha256: "f".repeat(64),
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "idempotency_conflict",
      status: 409,
    });
  });

  test("marks a concurrent assessment insert as replayed", async () => {
    const assessTask = createAssessTaskService({
      loadEvidence: async () => smallEvidence,
      store: createMemoryAssessmentStore(false),
    });
    const assessment = await assessTask(
      { apiKeyId: "key", userId: USER_ID },
      {
        idempotency_key: "assessment-concurrent-001",
        repository_binding_id: SMALL_BINDING_ID,
        task: ZERO_DIVISION_TASK_CONTRACT,
      },
    );

    expect(assessment.replayed).toBe(true);
  });

  test("derives bounded deterministic analysis IDs from 160-character keys", () => {
    const idempotencyKey = "x".repeat(160);
    const first = createInternalTaskAnalysisId({
      idempotencyKey,
      repositoryBindingId: SMALL_BINDING_ID,
      scope: "assessment",
    });
    const second = createInternalTaskAnalysisId({
      idempotencyKey,
      repositoryBindingId: SMALL_BINDING_ID,
      scope: "assessment",
    });

    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(120);
  });
});

describe("binding-backed executable quote contracts", () => {
  test("produces meaningfully different fixed prices for different snapshots and tasks", async () => {
    const store = createMemoryQuoteStore();
    const quoteTask = createSnapshotQuoteService({
      loadEvidence: async (_principal, bindingId) =>
        bindingId === SMALL_BINDING_ID
          ? smallEvidence
          : largeEvidence,
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      store,
    });
    const smallQuote = await quoteTask(
      { apiKeyId: "key", userId: USER_ID },
      {
        idempotency_key: "quote-small-shape-001",
        repository_binding_id: SMALL_BINDING_ID,
        task: ZERO_DIVISION_TASK_CONTRACT,
      },
    );
    const largeQuote = await quoteTask(
      { apiKeyId: "key", userId: USER_ID },
      {
        idempotency_key: "quote-large-shape-001",
        repository_binding_id: LARGE_BINDING_ID,
        task: featureTask,
      },
    );

    expect(smallQuote.status).toBe("pending");
    expect(largeQuote.amount_cents).toBeGreaterThan(
      smallQuote.amount_cents,
    );
    expect(largeQuote.contract_hash).not.toBe(
      smallQuote.contract_hash,
    );
    expect(smallQuote.pricing_evidence_hash).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(
      createContractHash({
        amountCents: smallQuote.amount_cents,
        currency: smallQuote.currency,
        expiresAt: smallQuote.expires_at,
        pricingEvidence: smallQuote.pricing,
        pricingEvidenceHash: smallQuote.pricing_evidence_hash,
        pricingModelVersion: smallQuote.pricing_model_version,
        repositoryEvidence: {
          baseBranch: smallQuote.repository.base_branch,
          baseSha: smallQuote.repository.base_sha,
          bindingId: smallQuote.repository.binding_id,
          githubRepositoryId:
            smallQuote.repository.github_repository_id,
          manifestHash: smallQuote.repository.manifest_hash,
          repositoryFullName: smallQuote.repository.full_name,
          repositoryUrl: smallQuote.repository.url,
          snapshotId: smallQuote.repository.snapshot_id,
        },
        repositorySha: smallQuote.repository_sha,
        repositoryUrl: smallQuote.repository_url,
        task: smallQuote.task,
        terms: smallQuote.terms,
      }),
    ).toBe(smallQuote.contract_hash);
  });

  test.each(["decompose", "decline"] as const)(
    "persists estimator %s decisions as rejected quotes",
    async (estimatorDecision) => {
      const baseEvaluation = await evaluateSnapshotTask({
        evidence: smallEvidence,
        task: ZERO_DIVISION_TASK_CONTRACT,
        taskId: `forced-${estimatorDecision}`,
      });
      const estimate = {
        ...baseEvaluation.estimate,
        decision: estimatorDecision,
      };
      const store = createMemoryQuoteStore();
      const quoteTask = createSnapshotQuoteService({
        evaluateTask: async () => ({
          ...baseEvaluation,
          decision: estimatorDecision,
          estimate,
          pricing: deriveSnapshotPricing({
            analysis: baseEvaluation.analysis,
            estimate,
            manifest: smallEvidence.snapshot.manifest,
          }),
        }),
        loadEvidence: async () => smallEvidence,
        now: () => new Date("2026-07-31T00:00:00.000Z"),
        store,
      });
      const quote = await quoteTask(
        { apiKeyId: "key", userId: USER_ID },
        {
          idempotency_key: `quote-${estimatorDecision}-001`,
          repository_binding_id: SMALL_BINDING_ID,
          task: ZERO_DIVISION_TASK_CONTRACT,
        },
      );

      expect(quote.status).toBe("rejected");
      expect(quote.eligibility).toMatchObject({
        code: `estimator_${estimatorDecision}`,
        eligible: false,
        estimatorDecision,
      });
      expect(quote.pricing.estimatorDecision).toBe(
        estimatorDecision,
      );
      expect(quote.terms).toMatch(
        estimatorDecision === "decompose"
          ? /decomposed/iu
          : /declined/iu,
      );
    },
  );

  test("allows accept_with_conditions only with immutable customer-visible conditions", async () => {
    const baseEvaluation = await evaluateSnapshotTask({
      evidence: smallEvidence,
      task: ZERO_DIVISION_TASK_CONTRACT,
      taskId: "forced-conditional",
    });
    const estimate = {
      ...baseEvaluation.estimate,
      decision: "accept_with_conditions" as const,
    };
    const quoteTask = createSnapshotQuoteService({
      evaluateTask: async () => ({
        ...baseEvaluation,
        decision: "accept_with_conditions" as const,
        estimate,
        pricing: deriveSnapshotPricing({
          analysis: baseEvaluation.analysis,
          estimate,
          manifest: smallEvidence.snapshot.manifest,
        }),
      }),
      loadEvidence: async () => smallEvidence,
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      store: createMemoryQuoteStore(),
    });
    const quote = await quoteTask(
      { apiKeyId: "key", userId: USER_ID },
      {
        idempotency_key: "quote-conditional-001",
        repository_binding_id: SMALL_BINDING_ID,
        task: ZERO_DIVISION_TASK_CONTRACT,
      },
    );

    expect(quote.status).toBe("pending");
    expect(quote.eligibility).toMatchObject({
      conditions: [ACCEPT_WITH_CONDITIONS_NOTICE],
      eligible: true,
      estimatorDecision: "accept_with_conditions",
    });
    expect(quote.pricing.executionConditions).toEqual([
      ACCEPT_WITH_CONDITIONS_NOTICE,
    ]);
    expect(quote.pricing.factors).toContain(
      `Execution condition: ${ACCEPT_WITH_CONDITIONS_NOTICE}`,
    );
    expect(quote.terms).toContain(ACCEPT_WITH_CONDITIONS_NOTICE);
  });

  test("fails closed when estimator and customer pricing evidence disagree", async () => {
    const baseEvaluation = await evaluateSnapshotTask({
      evidence: smallEvidence,
      task: ZERO_DIVISION_TASK_CONTRACT,
      taskId: "mismatched-evidence",
    });
    const quoteTask = createSnapshotQuoteService({
      evaluateTask: async () => ({
        ...baseEvaluation,
        pricing: {
          ...baseEvaluation.pricing,
          customer: {
            ...baseEvaluation.pricing.customer,
            estimatorDecision: "decline" as const,
          },
        },
      }),
      loadEvidence: async () => smallEvidence,
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      store: createMemoryQuoteStore(),
    });

    await expect(
      quoteTask(
        { apiKeyId: "key", userId: USER_ID },
        {
          idempotency_key: "quote-mismatched-evidence-001",
          repository_binding_id: SMALL_BINDING_ID,
          task: ZERO_DIVISION_TASK_CONTRACT,
        },
      ),
    ).rejects.toMatchObject({
      code: "invalid_pricing_evidence",
      status: 500,
    });
  });

  test("rejects non-allowlisted bindings after pricing their stored snapshot", async () => {
    const store = createMemoryQuoteStore();
    const quoteTask = createSnapshotQuoteService({
      loadEvidence: async () => largeEvidence,
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      store,
    });
    const quote = await quoteTask(
      { apiKeyId: "key", userId: USER_ID },
      {
        idempotency_key: "quote-commerce-001",
        repository_binding_id: LARGE_BINDING_ID,
        task: featureTask,
      },
    );

    expect(quote.status).toBe("rejected");
    expect(quote.eligibility.code).toBe("repository_not_allowed");
    expect(quote.repository.manifest_hash).toBe(
      largeEvidence.binding.manifestHash,
    );
    expect(quote.pricing.range.highCents).toBe(quote.amount_cents);
  });

  test("changes contract hashes with binding and manifest evidence", () => {
    const baseContract = {
      amountCents: 900,
      currency: "AUD" as const,
      expiresAt: "2026-07-31T00:30:00.000Z",
      pricingEvidence: { policyVersion: "policy:2.0.0" },
      pricingEvidenceHash: "c".repeat(64),
      pricingModelVersion: "policy:2.0.0",
      repositorySha: FIXTURE_REPOSITORY.baselineSha,
      repositoryUrl: FIXTURE_REPOSITORY.url,
      task: ZERO_DIVISION_TASK_CONTRACT,
      terms: "Immutable snapshot terms.",
    };
    const firstHash = createContractHash({
      ...baseContract,
      repositoryEvidence: {
        bindingId: SMALL_BINDING_ID,
        manifestHash: "a".repeat(64),
      },
    });
    const changedBindingHash = createContractHash({
      ...baseContract,
      repositoryEvidence: {
        bindingId: LARGE_BINDING_ID,
        manifestHash: "a".repeat(64),
      },
    });
    const changedManifestHash = createContractHash({
      ...baseContract,
      repositoryEvidence: {
        bindingId: SMALL_BINDING_ID,
        manifestHash: "b".repeat(64),
      },
    });
    const changedPricingHash = createContractHash({
      ...baseContract,
      pricingEvidenceHash: "d".repeat(64),
      repositoryEvidence: {
        bindingId: SMALL_BINDING_ID,
        manifestHash: "a".repeat(64),
      },
    });

    expect(changedBindingHash).not.toBe(firstHash);
    expect(changedManifestHash).not.toBe(firstHash);
    expect(changedPricingHash).not.toBe(firstHash);
  });

  test("includes binding identity in quote replay conflicts", async () => {
    const store = createMemoryQuoteStore();
    const quoteTask = createSnapshotQuoteService({
      loadEvidence: async () => smallEvidence,
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      store,
    });
    const input = {
      idempotency_key: "quote-binding-replay-001",
      repository_binding_id: SMALL_BINDING_ID,
      task: ZERO_DIVISION_TASK_CONTRACT,
    };

    await quoteTask(
      { apiKeyId: "key", userId: USER_ID },
      input,
    );

    await expect(
      quoteTask(
        { apiKeyId: "key", userId: USER_ID },
        {
          ...input,
          repository_binding_id: LARGE_BINDING_ID,
        },
      ),
    ).rejects.toMatchObject({
      code: "idempotency_conflict",
      status: 409,
    });
  });

  test("marks an atomic concurrent quote result as replayed", async () => {
    const quoteTask = createSnapshotQuoteService({
      loadEvidence: async () => smallEvidence,
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      store: createMemoryQuoteStore(false),
    });
    const quote = await quoteTask(
      { apiKeyId: "key", userId: USER_ID },
      {
        idempotency_key: "quote-concurrent-001",
        repository_binding_id: SMALL_BINDING_ID,
        task: ZERO_DIVISION_TASK_CONTRACT,
      },
    );

    expect(quote.replayed).toBe(true);
  });

  test("returns durably expired quotes as expired on replay", async () => {
    const store = createMemoryQuoteStore();
    const quoteTask = createSnapshotQuoteService({
      loadEvidence: async () => smallEvidence,
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      store,
    });
    const input = {
      idempotency_key: "quote-expired-replay-001",
      repository_binding_id: SMALL_BINDING_ID,
      task: ZERO_DIVISION_TASK_CONTRACT,
    };
    await quoteTask(
      { apiKeyId: "key", userId: USER_ID },
      input,
    );
    const persisted = store.rows.get(
      `${USER_ID}:${input.idempotency_key}`,
    );

    if (!persisted) {
      throw new Error("Expected persisted quote.");
    }

    persisted.status = "expired";
    const replay = await quoteTask(
      { apiKeyId: "key", userId: USER_ID },
      input,
    );

    expect(replay.replayed).toBe(true);
    expect(replay.status).toBe("expired");
  });
});

describe("ownership, API input, and migration contracts", () => {
  test("discovers safe active installation DTOs and derives capture ownership from the principal", async () => {
    const capture = vi.fn(async () => ({
      binding: smallEvidence.binding,
      bindingId: smallEvidence.bindingId,
      snapshot: smallEvidence.snapshot,
      snapshotId: smallEvidence.snapshotId,
    }));
    const listActive = vi.fn(async () => [
      {
        account_login: "acme",
        account_type: "Organization",
        created_at: "2026-07-31T00:00:00.000Z",
        id: INSTALLATION_ID,
        repository_selection: "selected" as const,
        suspended_at: null,
      },
    ]);
    const service = createRepositoryApplicationService({
      capture,
      installationStore: { listActive },
    });
    const principal = { apiKeyId: "key", userId: USER_ID };
    const installations = await service.listInstallations(principal);
    const result = await service.captureBinding(principal, {
      base_branch: "main",
      base_sha: FIXTURE_REPOSITORY.baselineSha,
      repository_url: FIXTURE_REPOSITORY.url,
      stored_installation_id: INSTALLATION_ID,
    });

    expect(listActive).toHaveBeenCalledWith(USER_ID);
    expect(installations).toEqual([
      expect.objectContaining({
        installation_generation_id: INSTALLATION_ID,
        status: "active",
      }),
    ]);
    expect(JSON.stringify(installations)).not.toContain("token");
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
    );
    expect(result.binding.id).toBe(SMALL_BINDING_ID);
  });

  test.each([
    ["installation_not_owned", 404],
    ["repository_access_denied", 403],
    ["base_ref_mismatch", 409],
    ["commit_tree_mismatch", 409],
  ] as Array<[RepositoryCaptureErrorCode, number]>)(
    "maps typed preflight %s failures without message inspection",
    async (captureCode, expectedStatus) => {
      const service = createRepositoryApplicationService({
        capture: async () => {
          throw new RepositoryCaptureError(
            captureCode,
            "Typed preflight failure.",
          );
        },
        installationStore: {
          listActive: async () => [],
        },
      });

      await expect(
        service.captureBinding(
          { apiKeyId: "key", userId: USER_ID },
          {
            base_branch: "main",
            base_sha: FIXTURE_REPOSITORY.baselineSha,
            repository_url: FIXTURE_REPOSITORY.url,
            stored_installation_id: INSTALLATION_ID,
          },
        ),
      ).rejects.toMatchObject({ status: expectedStatus });
    },
  );

  test("loads evidence only through the authenticated owner identity", async () => {
    const findBinding = vi.fn(async () => null);
    const loadEvidence = createRepositoryEvidenceLoader({
      findBinding,
      findSnapshot: vi.fn(async () => null),
    });

    await expect(
      loadEvidence(
        { apiKeyId: "key", userId: OTHER_USER_ID },
        SMALL_BINDING_ID,
      ),
    ).rejects.toBeInstanceOf(ControlPlaneError);
    expect(findBinding).toHaveBeenCalledWith({
      bindingId: SMALL_BINDING_ID,
      userId: OTHER_USER_ID,
    });
  });

  test("never accepts a caller-supplied user id in repository preflight", () => {
    expect(
      repositoryCaptureRequestSchema.safeParse({
        base_branch: "main",
        base_sha: FIXTURE_REPOSITORY.baselineSha,
        repository_url: FIXTURE_REPOSITORY.url,
        stored_installation_id: INSTALLATION_ID,
        user_id: OTHER_USER_ID,
      }).success,
    ).toBe(false);
  });

  test("advertises only canonical binding-backed quote fields to MCP", () => {
    expect(Object.keys(bindingQuoteInputShape).sort()).toEqual([
      "idempotency_key",
      "repository_binding_id",
      "task",
    ]);
  });

  test("maps the committed expired RPC result to a quote conflict", () => {
    expect(() =>
      requireAcceptedTaskId({
        status: "expired",
        task_id: null,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "quote_expired",
        status: 409,
      }),
    );
  });

  test("declares immutable evidence, ownership FKs, RLS, grants, and acceptance copying", async () => {
    const migration = await readFile(
      path.join(
        process.cwd(),
        "supabase/migrations/20260730151707_quote_repository_evidence.sql",
      ),
      "utf8",
    );
    const snapshotQuoteService = await readFile(
      path.join(
        process.cwd(),
        "src/lib/control-plane/snapshot-quotes.ts",
      ),
      "utf8",
    );
    const atomicFunction = migration.match(
      /create function public[.]create_snapshot_quote_with_underwriting\([\s\S]*?(?=create or replace function public[.]accept_quote_and_create_task)/u,
    )?.[0];

    expect(atomicFunction).toBeDefined();
    expect(atomicFunction ?? "").toContain("pg_advisory_xact_lock");
    expect(atomicFunction ?? "").toContain("insert into public.quotes");
    expect(atomicFunction ?? "").toContain(
      "insert into public.quote_underwriting",
    );
    expect(snapshotQuoteService).toContain(
      '.rpc(\n        "create_snapshot_quote_with_underwriting"',
    );
    expect(snapshotQuoteService).not.toContain(
      '.from("quotes")\n        .insert',
    );
    expect(migration).toContain("create table public.assessments");
    expect(migration).toContain(
      "constraint assessments_repository_binding_evidence_fkey foreign key",
    );
    expect(migration).toContain(
      "constraint quotes_repository_binding_evidence_fkey foreign key",
    );
    expect(migration).toContain(
      "constraint tasks_repository_binding_evidence_fkey foreign key",
    );
    expect(migration).toContain(
      "before update on public.assessments",
    );
    expect(migration).toContain(
      "before update on public.quote_underwriting",
    );
    expect(migration).toContain(
      "before update on public.tasks",
    );
    expect(migration).toContain(
      "Quote repository and pricing evidence is immutable",
    );
    expect(migration).toContain(
      "Snapshot-backed quote contract is immutable",
    );
    expect(migration).toContain(
      "Task repository evidence is immutable",
    );
    expect(migration).not.toContain(
      'create policy "assessments_select_own"',
    );
    expect(migration).not.toContain(
      "grant select on table public.assessments to authenticated",
    );
    expect(migration).toContain(
      "grant select, insert on table public.assessments to service_role",
    );
    expect(migration).not.toMatch(
      /grant (insert|update|delete)[^;]*on table public[.]assessments[^;]*to authenticated/iu,
    );
    expect(migration).toContain("security invoker");
    expect(migration.toLowerCase()).not.toContain("security definer");
    expect(migration).toContain(
      "selected_quote.repository_binding_id",
    );
    expect(migration).toContain(
      "accepted_task.repository_snapshot_id is distinct from selected_quote.repository_snapshot_id",
    );
    expect(migration).toContain(
      "quotes_snapshot_execution_gate_check",
    );
    expect(migration).toContain(
      "Quote estimator decision is not executable",
    );
    expect(migration).toContain(
      "pricing_evidence ->> 'estimatorDecision'",
    );
    expect(migration).toContain(
      "coalesce(source_evidence ->> 'content_sha256', '')",
    );
    expect(migration).toContain(
      "and pricing_evidence_hash is not null",
    );
    expect(migration).toContain(
      "create function public.create_snapshot_quote_with_underwriting",
    );
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain(
      "Quote underwriting evidence does not match",
    );
    expect(migration).toMatch(
      /set status = 'expired'[\s\S]*return query\s+select null::uuid, false, 'expired'::text;/u,
    );
    expect(migration).not.toMatch(
      /set status = 'expired'[\s\S]{0,120}raise exception/iu,
    );
    expect(migration).toContain(
      "grant execute on function public.create_snapshot_quote_with_underwriting",
    );
    expect(migration).not.toMatch(
      /^  constraint (quotes_|quote_underwriting_|tasks_)/mu,
    );
  });
});
