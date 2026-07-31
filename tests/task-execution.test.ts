import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  buildAcceptedTaskPrompt,
  createTaskExecutionOrchestrator,
  type TaskExecutionClaim,
  type TaskExecutionEvidence,
  type TaskExecutionOutput,
  type TaskExecutionStore,
} from "@/lib/control-plane/task-execution";
import {
  createControlPlaneReconciler,
  shouldReconcileCloudTask,
} from "@/lib/control-plane/reconciliation";
import { createContractHash } from "@/lib/pricing/quote-policy";
import { createPublicationBranch } from "@/lib/github-app/publisher";
import { SNAPSHOT_PRICING_POLICY } from "@/lib/pricing/snapshot-policy";
import {
  FIXTURE_MANIFEST,
  FIXTURE_REPOSITORY,
  ZERO_DIVISION_TASK_CONTRACT,
} from "@/lib/pricing/registry";
import {
  REPOSITORY_BINDING_SCHEMA_VERSION,
  REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
  calculateRepositoryManifestHash,
  parseRepositorySnapshot,
  repositoryBindingSchema,
} from "@/lib/repositories/domain";
import { sha256CanonicalJson } from "@/lib/repositories/hash";
import { PermanentTaskExecutionError } from "@/lib/workers/isolated/errors";
import {
  GET,
  getReconciliationHttpStatus,
  isAuthorizedInternalRequest,
} from "@/app/api/internal/task-executions/reconcile/route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => null,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const QUOTE_ID = "33333333-3333-4333-8333-333333333333";
const BINDING_ID = "44444444-4444-4444-8444-444444444444";
const SNAPSHOT_ID = "55555555-5555-4555-8555-555555555555";
const INSTALLATION_GENERATION_ID =
  "66666666-6666-4666-8666-666666666666";

const claim: TaskExecutionClaim = {
  attemptId: "77777777-7777-4777-8777-777777777777",
  claimCount: 1,
  claimToken: "88888888-8888-4888-8888-888888888888",
  failureCount: 0,
  leaseExpiresAt: "2026-07-31T02:30:00.000Z",
  taskId: TASK_ID,
  userId: USER_ID,
};

const output: TaskExecutionOutput = {
  publication: {
    baseBranch: "main",
    baseSha: FIXTURE_REPOSITORY.baselineSha,
    branch: "outcomes/task-abc123abc123",
    changedFiles: ["src/calculator.js"],
    commitAuthor: "outcomes[bot]",
    commitSha: "b".repeat(40),
    deliveryStatus: "open",
    prAuthor: "outcomes[bot]",
    prNumber: 7,
    prUrl: "https://github.com/w-v-r/agent-cost-benchmark-fixture/pull/7",
  },
  run: {
    agentId: "agent-1",
    modelId: "composer-2.5",
    output: "Completed",
    runId: "run-1",
    usage: { inputTokens: 10 },
  },
};

const createEvidence = (): TaskExecutionEvidence => {
  const manifest = {
    ...FIXTURE_MANIFEST,
    snapshot: {
      commitSha: FIXTURE_REPOSITORY.baselineSha,
      dirty: false as const,
    },
    source: {
      kind: "github" as const,
      ref: FIXTURE_REPOSITORY.baselineSha,
      url: FIXTURE_REPOSITORY.url,
    },
  };
  const snapshot = parseRepositorySnapshot({
    commitSha: FIXTURE_REPOSITORY.baselineSha,
    manifest,
    manifestHash: calculateRepositoryManifestHash(manifest),
    repository: {
      canonicalUrl: FIXTURE_REPOSITORY.url,
      fullName: FIXTURE_REPOSITORY.fullName,
      githubRepositoryId: 101,
      visibility: "private",
    },
    scanner: { id: "scanner", version: "1" },
    schemaVersion: REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
    treeSha: "a".repeat(40),
  });
  const binding = repositoryBindingSchema.parse({
    accessBinding: {
      githubInstallationId: 987,
      provider: "github_app",
      storedInstallationId: INSTALLATION_GENERATION_ID,
    },
    baseBranch: "main",
    baseSha: FIXTURE_REPOSITORY.baselineSha,
    manifestHash: snapshot.manifestHash,
    provider: "github",
    repository: snapshot.repository,
    schemaVersion: REPOSITORY_BINDING_SCHEMA_VERSION,
    snapshotId: SNAPSHOT_ID,
  });
  const pricingEvidence = {
    estimator: { id: "deterministic", version: "1" },
    estimatorDecision: "accept",
  };
  const pricingEvidenceHash = sha256CanonicalJson({
    customer: pricingEvidence,
    policy: SNAPSHOT_PRICING_POLICY,
  });
  const quoteBase = {
    amountCents: 1_250,
    currency: "AUD" as const,
    expiresAt: "2026-08-01T00:00:00.000Z",
    pricingEvidence,
    pricingEvidenceHash,
    pricingModelVersion: "snapshot-v1",
    repositoryEvidence: {
      baseBranch: binding.baseBranch,
      baseSha: binding.baseSha,
      bindingId: BINDING_ID,
      githubRepositoryId: binding.repository.githubRepositoryId,
      manifestHash: binding.manifestHash,
      repositoryFullName: binding.repository.fullName,
      repositoryUrl: binding.repository.canonicalUrl,
      snapshotId: SNAPSHOT_ID,
    },
    repositorySha: binding.baseSha,
    repositoryUrl: binding.repository.canonicalUrl,
    task: ZERO_DIVISION_TASK_CONTRACT,
    terms: "Charge only after independent verification.",
  };
  const contractHash = createContractHash(quoteBase);

  return {
    installation: {
      appId: 123,
      disconnectedAt: null,
      id: INSTALLATION_GENERATION_ID,
      installationId: 987,
      permissions: {
        actions: "write",
        contents: "write",
        pull_requests: "write",
      },
      suspendedAt: null,
      userId: USER_ID,
    },
    quote: {
      acceptanceIdempotencyKey: "acceptance-001",
      amountCents: quoteBase.amountCents,
      contractHash,
      currency: quoteBase.currency,
      eligibilityDecision: { eligible: true },
      expiresAt: quoteBase.expiresAt,
      githubRepositoryId: binding.repository.githubRepositoryId,
      id: QUOTE_ID,
      manifestHash: binding.manifestHash,
      pricingEvidence,
      pricingEvidenceHash: quoteBase.pricingEvidenceHash,
      pricingModelVersion: quoteBase.pricingModelVersion,
      repositoryBaseBranch: binding.baseBranch,
      repositoryBindingId: BINDING_ID,
      repositoryFullName: binding.repository.fullName,
      repositorySha: binding.baseSha,
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryUrl: binding.repository.canonicalUrl,
      status: "approved",
      taskId: TASK_ID,
      taskSpec: ZERO_DIVISION_TASK_CONTRACT,
      terms: quoteBase.terms,
      userId: USER_ID,
    },
    recovery: null,
    repository: {
      binding,
      bindingId: BINDING_ID,
      snapshot,
      snapshotId: SNAPSHOT_ID,
      userId: USER_ID,
    },
    task: {
      acceptanceCriteria:
        ZERO_DIVISION_TASK_CONTRACT.acceptanceCriteria.join("\n"),
      description: ZERO_DIVISION_TASK_CONTRACT.description,
      githubRepositoryId: binding.repository.githubRepositoryId,
      id: TASK_ID,
      manifestHash: binding.manifestHash,
      quoteId: QUOTE_ID,
      repositoryBaseBranch: binding.baseBranch,
      repositoryBindingId: BINDING_ID,
      repositoryFullName: binding.repository.fullName,
      repositorySha: binding.baseSha,
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryUrl: binding.repository.canonicalUrl,
      status: "starting",
      taskSpec: ZERO_DIVISION_TASK_CONTRACT,
      title: ZERO_DIVISION_TASK_CONTRACT.description,
      userId: USER_ID,
    },
    underwriting: {
      analysis: {
        likelyRelevantFiles: [
          { path: "src/calculator.js" },
          { path: "test/calculator.test.js" },
        ],
      },
      estimatorId: "deterministic",
      estimatorVersion: "1",
      manifestHash: binding.manifestHash,
      pricingEvidenceHash: quoteBase.pricingEvidenceHash,
      pricingPolicyVersion: quoteBase.pricingModelVersion,
      quoteId: QUOTE_ID,
      repositoryBindingId: BINDING_ID,
      repositorySha: binding.baseSha,
      repositorySnapshotId: SNAPSHOT_ID,
      userId: USER_ID,
    },
  };
};

const createStore = (
  evidence = createEvidence(),
): TaskExecutionStore & {
  claim: ReturnType<typeof vi.fn<TaskExecutionStore["claim"]>>;
  complete: ReturnType<typeof vi.fn<TaskExecutionStore["complete"]>>;
  defer: ReturnType<typeof vi.fn<TaskExecutionStore["defer"]>>;
  fail: ReturnType<typeof vi.fn<TaskExecutionStore["fail"]>>;
  recordPrepublication: ReturnType<
    typeof vi.fn<TaskExecutionStore["recordPrepublication"]>
  >;
  renew: ReturnType<typeof vi.fn<TaskExecutionStore["renew"]>>;
} => {
  const complete = vi.fn<TaskExecutionStore["complete"]>(async () => true);
  const claimTask = vi.fn<TaskExecutionStore["claim"]>(async () => [claim]);
  const defer = vi.fn<TaskExecutionStore["defer"]>(async () => true);
  const fail = vi.fn<TaskExecutionStore["fail"]>(async () => true);
  const recordPrepublication = vi.fn<
    TaskExecutionStore["recordPrepublication"]
  >(
    async () => true,
  );
  const renew = vi.fn<TaskExecutionStore["renew"]>(async () => true);

  return {
    claim: claimTask,
    complete,
    defer,
    fail,
    loadEvidence: async () => evidence,
    recordPrepublication,
    renew,
  };
};

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.restoreAllMocks();
});

describe("durable task execution orchestration", () => {
  test("executes the exact accepted contract and persists one run and publication", async () => {
    const store = createStore();
    const execute = vi.fn(async (input) => {
      expect(input.allowedPaths).toEqual(["src/calculator.js"]);
      expect(input.baseSha).toBe(FIXTURE_REPOSITORY.baselineSha);
      expect(input.prompt).toBe(
        buildAcceptedTaskPrompt(ZERO_DIVISION_TASK_CONTRACT, [
          "src/calculator.js",
        ]),
      );
      expect(input.prompt).toContain("Do not modify tests.");
      expect(input.taskIdentity).toBe(createEvidence().quote.contractHash);
      await input.onPrepublication({
        branch: output.publication.branch,
        changes: [
          {
            contentBase64: Buffer.from("change").toString("base64"),
            mode: "100644",
            path: "src/calculator.js",
            status: "modified",
          },
        ],
        run: output.run,
      });
      return output;
    });
    const reconcile = createTaskExecutionOrchestrator({
      executor: { execute },
      store,
    });

    await expect(
      reconcile({ batchSize: 1, claimedBy: "test-worker" }),
    ).resolves.toEqual({
      claimed: 1,
      results: [{ status: "succeeded", taskId: TASK_ID }],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.recordPrepublication).toHaveBeenCalledTimes(1);
    expect(store.complete).toHaveBeenCalledTimes(1);
    expect(store.fail).not.toHaveBeenCalled();
  });

  test.each([
    ["contract hash", (evidence: TaskExecutionEvidence) => {
      evidence.quote.contractHash = "f".repeat(64);
    }, "quote_contract_mismatch"],
    ["revoked access", (evidence: TaskExecutionEvidence) => {
      evidence.installation.disconnectedAt = "2026-07-31T00:00:00.000Z";
    }, "repository_access_revoked"],
    ["snapshot SHA", (evidence: TaskExecutionEvidence) => {
      evidence.task.repositorySha = "d".repeat(40);
    }, "accepted_contract_mismatch"],
  ])("fails closed on mismatched %s evidence", async (
    _label,
    mutate,
    expectedCode,
  ) => {
    const evidence = createEvidence();
    mutate(evidence);
    const store = createStore(evidence);
    const execute = vi.fn(async () => output);
    const reconcile = createTaskExecutionOrchestrator({
      executor: { execute },
      store,
    });

    const result = await reconcile({
      batchSize: 1,
      claimedBy: "test-worker",
    });

    expect(result.results).toEqual([
      { code: expectedCode, status: "failed", taskId: TASK_ID },
    ]);
    expect(execute).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        customerCode: expectedCode,
      }),
    );
  });

  test("leaves a lost publication-persistence lease recoverable", async () => {
    const store = createStore();
    store.complete.mockResolvedValueOnce(false);
    store.fail.mockResolvedValueOnce(false);
    const execute = vi.fn(async (input) => {
      await input.onPrepublication({
        branch: output.publication.branch,
        changes: [
          {
            contentBase64: Buffer.from("change").toString("base64"),
            mode: "100644",
            path: "src/calculator.js",
            status: "modified",
          },
        ],
        run: output.run,
      });
      return output;
    });
    const reconcile = createTaskExecutionOrchestrator({
      executor: { execute },
      store,
    });
    const result = await reconcile({
      batchSize: 1,
      claimedBy: "test-worker",
    });

    expect(result.results[0]).toMatchObject({
      code: "execution_lease_lost",
      status: "lease_lost",
    });
    expect(store.complete).toHaveBeenCalledTimes(1);
    expect(store.fail).not.toHaveBeenCalled();
    expect(store.defer).not.toHaveBeenCalled();
  });

  test("defers retryable failures with bounded exponential backoff", async () => {
    const store = createStore();
    const reconcile = createTaskExecutionOrchestrator({
      executor: {
        execute: async () => {
          throw new Error("Transient provider outage");
        },
      },
      store,
    });

    await expect(
      reconcile({ batchSize: 5, claimedBy: "test-worker" }),
    ).resolves.toEqual({
      claimed: 1,
      results: [
        {
          code: "worker_execution_failed",
          status: "retry_scheduled",
          taskId: TASK_ID,
        },
      ],
    });
    expect(store.defer).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfterSeconds: 30 }),
    );
    expect(store.fail).not.toHaveBeenCalled();
    expect(store.claim).toHaveBeenCalledWith(
      expect.objectContaining({ batchSize: 1 }),
    );
  });

  test("terminalizes retryable failures only after the bounded limit", async () => {
    const store = createStore();
    store.claim.mockResolvedValueOnce([{ ...claim, failureCount: 2 }]);
    const reconcile = createTaskExecutionOrchestrator({
      executor: {
        execute: async () => {
          throw new Error("Repeated provider outage");
        },
      },
      store,
    });

    const result = await reconcile({
      batchSize: 1,
      claimedBy: "test-worker",
    });

    expect(result.results[0]).toMatchObject({ status: "failed" });
    expect(store.fail).toHaveBeenCalledTimes(1);
    expect(store.defer).not.toHaveBeenCalled();
  });

  test("terminalizes deterministic unsafe output without retrying", async () => {
    const store = createStore();
    const reconcile = createTaskExecutionOrchestrator({
      executor: {
        execute: async () => {
          throw new PermanentTaskExecutionError(
            "unsafe_worker_output",
            "The worker output violated the bounded change policy.",
          );
        },
      },
      store,
    });

    const result = await reconcile({
      batchSize: 1,
      claimedBy: "test-worker",
    });

    expect(result.results[0]).toMatchObject({
      code: "unsafe_worker_output",
      status: "failed",
    });
    expect(store.fail).toHaveBeenCalledTimes(1);
    expect(store.defer).not.toHaveBeenCalled();
  });

  test("reuses persisted validated changes without rerunning Cursor", async () => {
    const evidence = createEvidence();
    const changes = [
      {
        contentBase64: Buffer.from("recovered change").toString("base64"),
        mode: "100644" as const,
        path: "src/calculator.js",
        status: "modified" as const,
      },
    ];
    const branch = createPublicationBranch({
      baseSha: evidence.task.repositorySha,
      changes,
      taskIdentity: evidence.quote.contractHash,
    });
    evidence.recovery = {
      branch,
      changes,
      run: output.run,
    };
    const store = createStore(evidence);
    const execute = vi.fn(async (input) => {
      expect(input.recovery).toEqual(evidence.recovery);
      await input.onPrepublication({
        branch,
        changes,
        run: output.run,
      });
      return {
        ...output,
        publication: { ...output.publication, branch },
      };
    });
    const reconcile = createTaskExecutionOrchestrator({
      executor: { execute },
      store,
    });

    await reconcile({ batchSize: 1, claimedBy: "recovery-worker" });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.recordPrepublication).toHaveBeenCalledTimes(1);
    expect(store.complete).toHaveBeenCalledTimes(1);
  });

  test("migration claims with row locks, stale leases, and terminal exclusion", async () => {
    const [migration, acceptanceService, isolatedWorker] = await Promise.all([
      readFile(
        path.join(
          process.cwd(),
          "supabase/migrations/20260730163203_task_execution_claims.sql",
        ),
        "utf8",
      ),
      readFile(
        path.join(
          process.cwd(),
          "src/lib/control-plane/acceptance.ts",
        ),
        "utf8",
      ),
      readFile(
        path.join(
          process.cwd(),
          "src/lib/workers/isolated/github-app-spike.ts",
        ),
        "utf8",
      ),
    ]);

    expect(migration).toContain("for update of task skip locked");
    expect(migration).toContain("attempt.lease_expires_at <= claim_now");
    expect(migration).toContain(
      "task.status in ('approved', 'starting', 'executing')",
    );
    expect(migration).toContain(
      "constraint task_execution_attempts_task_key unique (task_id)",
    );
    expect(migration).toContain(
      "claim_token = pg_catalog.gen_random_uuid()",
    );
    expect(migration).toContain(
      "task.worker_runtime = 'isolated_local'",
    );
    expect(migration).toContain("task.worker_provider = 'cursor'");
    expect(migration).toContain(
      "where repository_binding_id is not null",
    );
    expect(migration).toContain("worker_runtime = 'isolated_local'");
    expect(migration).toContain("task.agent_id is null");
    expect(migration).toContain("task.run_id is null");
    expect(migration).toContain(
      "create function public.renew_task_execution_lease",
    );
    expect(migration).toContain(
      "create function public.defer_task_execution",
    );
    expect(migration).toContain("and lease_expires_at > transition_now");
    expect(migration).toContain("state = 'retry_wait'");
    expect(migration).not.toContain(
      "create function public.record_task_execution_run",
    );
    expect(migration).not.toContain(
      "create function public.record_task_execution_changes",
    );
    expect(migration).toContain("state = 'succeeded'");
    expect(migration).toContain("state = 'failed'");
    expect(migration).toContain(
      "create trigger tasks_derive_snapshot_contract_fields",
    );
    expect(migration).toContain(
      "create trigger payments_protect_reservation_evidence",
    );
    expect(migration).toContain(
      'drop policy if exists "payments_insert_own"',
    );
    expect(migration).toContain(
      "revoke insert, update on table public.payments from authenticated",
    );
    expect(migration).toContain(
      "new.title := pg_catalog.left",
    );
    expect(migration.toLowerCase()).not.toContain("security definer");
    expect(migration).not.toMatch(
      /grant execute[^;]+to (anon|authenticated)/iu,
    );
    expect(acceptanceService).toContain(
      '.rpc("accept_quote_and_create_task"',
    );
    expect(acceptanceService).not.toContain("startTask(");
    expect(acceptanceService).not.toContain("CursorCloudWorkerAdapter");
    expect(isolatedWorker).toContain(
      "appClient.getInstallation(installationId)",
    );
    expect(isolatedWorker).toContain(
      "baseRef.object.sha !== baseSha",
    );
    expect(isolatedWorker).toContain(
      "expectedRepositoryId",
    );
  });
});

describe("internal reconciliation route", () => {
  test("continues started binding-backed cloud work without starting new work", () => {
    expect(
      shouldReconcileCloudTask({
        repositoryBindingId: BINDING_ID,
        status: "starting",
        workerRuntime: "cloud",
      }),
    ).toBe(true);
    expect(
      shouldReconcileCloudTask({
        repositoryBindingId: BINDING_ID,
        status: "approved",
        workerRuntime: "cloud",
      }),
    ).toBe(false);
    expect(
      shouldReconcileCloudTask({
        repositoryBindingId: null,
        status: "approved",
        workerRuntime: "cloud",
      }),
    ).toBe(true);
  });

  test("rejects missing, wrong, and unconfigured secrets", async () => {
    const url =
      "http://localhost/api/internal/task-executions/reconcile";
    await expect(GET(new Request(url))).resolves.toMatchObject({
      status: 401,
    });

    process.env.CRON_SECRET = "correct-secret-value";
    expect(
      isAuthorizedInternalRequest(
        new Request(url, {
          headers: { Authorization: "Bearer correct-secret-value" },
        }),
      ),
    ).toBe(true);
    await expect(
      GET(
        new Request(url, {
          headers: { Authorization: "Bearer wrong-secret-value" },
        }),
      ),
    ).resolves.toMatchObject({ status: 401 });
  });

  test("advances downstream verification and payment states without status polling", async () => {
    const executeTasks = vi.fn(async () => ({
      claimed: 0,
      results: [],
    }));
    const reconcileLifecycle = vi.fn(async () => undefined);
    const reconcile = createControlPlaneReconciler({
      executeTasks,
      listDownstreamTasks: async () => [
        { id: TASK_ID, userId: USER_ID },
      ],
      reconcileLifecycle,
    });

    await expect(
      reconcile({ batchSize: 1, claimedBy: "cron:test" }),
    ).resolves.toEqual({
      downstream: [{ status: "reconciled", taskId: TASK_ID }],
      execution: { claimed: 0, results: [] },
      partial: false,
    });
    expect(reconcileLifecycle).toHaveBeenCalledWith({
      id: TASK_ID,
      userId: USER_ID,
    });
  });

  test("surfaces partial reconciliation when downstream work fails", async () => {
    const reconcile = createControlPlaneReconciler({
      executeTasks: async () => ({ claimed: 0, results: [] }),
      listDownstreamTasks: async () => [
        { id: TASK_ID, userId: USER_ID },
      ],
      reconcileLifecycle: async () => {
        throw new Error("provider unavailable");
      },
    });

    await expect(
      reconcile({ batchSize: 1, claimedBy: "cron:test" }),
    ).resolves.toMatchObject({
      downstream: [{ status: "failed", taskId: TASK_ID }],
      partial: true,
    });
    expect(getReconciliationHttpStatus(true)).toBe(207);
    expect(getReconciliationHttpStatus(false)).toBe(200);
  });
});
