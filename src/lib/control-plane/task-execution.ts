import "server-only";

import { type TaskContract, taskContractSchema } from "@outcomes/contracts";

import { createContractHash } from "@/lib/pricing/quote-policy";
import { decideTaskEligibility } from "@/lib/pricing/eligibility";
import { SNAPSHOT_PRICING_POLICY } from "@/lib/pricing/snapshot-policy";
import { createPublicationBranch } from "@/lib/github-app/publisher";
import {
  type OwnedRepositoryEvidence,
  loadOwnedRepositoryEvidence,
} from "@/lib/repositories/evidence";
import { sha256CanonicalJson } from "@/lib/repositories/hash";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type GitHubAppWorkerSpikeResult,
  runGitHubAppWorkerSpike,
} from "@/lib/workers/isolated/github-app-spike";
import { type IsolatedCursorRunResult } from "@/lib/workers/isolated/cursor-run";
import { PermanentTaskExecutionError } from "@/lib/workers/isolated/errors";
import {
  assertPersistedWorkspaceChanges,
  type ValidatedWorkspaceChange,
} from "@/lib/workers/isolated/workspace-changes";

import { ControlPlaneError } from "./errors";

const DEFAULT_LEASE_SECONDS = 90;
const HEARTBEAT_INTERVAL_MILLISECONDS = 20_000;
const MAX_EXECUTION_FAILURES = 3;
const DEFAULT_MODEL_ID = "composer-2.5";
const MAX_ALLOWED_PATHS = 10;

export type TaskExecutionClaim = {
  attemptId: string;
  claimCount: number;
  claimToken: string;
  failureCount: number;
  leaseExpiresAt: string;
  taskId: string;
  userId: string;
};

type StoredInstallationEvidence = {
  appId: number;
  disconnectedAt: string | null;
  id: string;
  installationId: number;
  permissions: Record<string, string>;
  suspendedAt: string | null;
  userId: string;
};

type AcceptedTaskEvidence = {
  acceptanceCriteria: string;
  description: string;
  githubRepositoryId: number;
  id: string;
  manifestHash: string;
  quoteId: string;
  repositoryBaseBranch: string;
  repositoryBindingId: string;
  repositoryFullName: string;
  repositorySha: string;
  repositorySnapshotId: string;
  repositoryUrl: string;
  status: string;
  taskSpec: TaskContract;
  title: string;
  userId: string;
};

type AcceptedQuoteEvidence = {
  acceptanceIdempotencyKey: string | null;
  amountCents: number;
  contractHash: string;
  currency: "AUD";
  eligibilityDecision: Record<string, unknown>;
  expiresAt: string;
  githubRepositoryId: number;
  id: string;
  manifestHash: string;
  pricingEvidence: unknown;
  pricingEvidenceHash: string;
  pricingModelVersion: string;
  repositoryBaseBranch: string;
  repositoryBindingId: string;
  repositoryFullName: string;
  repositorySha: string;
  repositorySnapshotId: string;
  repositoryUrl: string;
  status: string;
  taskId: string | null;
  taskSpec: TaskContract;
  terms: string;
  userId: string;
};

type UnderwritingEvidence = {
  analysis: {
    likelyRelevantFiles?: Array<{ path?: unknown }>;
  };
  estimatorId: string;
  estimatorVersion: string;
  manifestHash: string;
  pricingEvidenceHash: string;
  pricingPolicyVersion: string;
  quoteId: string;
  repositoryBindingId: string;
  repositorySha: string;
  repositorySnapshotId: string;
  userId: string;
};

export type TaskExecutionEvidence = {
  installation: StoredInstallationEvidence;
  quote: AcceptedQuoteEvidence;
  recovery: TaskExecutionRecovery | null;
  repository: OwnedRepositoryEvidence;
  task: AcceptedTaskEvidence;
  underwriting: UnderwritingEvidence;
};

export type TaskExecutionRecovery = {
  branch: string;
  changes: ValidatedWorkspaceChange[];
  run: PersistedWorkerRun;
};

export type PersistedWorkerRun = {
  agentId: string;
  modelId: string;
  output: string | null;
  runId: string;
  usage: Record<string, unknown> | null;
};

export type TaskExecutionInput = {
  allowedPaths: string[];
  assertLease: () => Promise<void>;
  baseBranch: string;
  baseSha: string;
  installationId: number;
  onPrepublication: (input: {
    branch: string;
    changes: ValidatedWorkspaceChange[];
    run: PersistedWorkerRun;
  }) => Promise<void>;
  prompt: string;
  pullRequestTitle: string;
  repositoryId: number;
  repositoryUrl: string;
  recovery: TaskExecutionRecovery | null;
  signal: AbortSignal;
  taskIdentity: string;
};

export type TaskExecutionOutput = {
  publication: GitHubAppWorkerSpikeResult["publication"];
  run: PersistedWorkerRun;
};

export type TaskExecutionStore = {
  claim: (input: {
    batchSize: number;
    claimedBy: string;
    leaseSeconds: number;
  }) => Promise<TaskExecutionClaim[]>;
  complete: (input: {
    claim: TaskExecutionClaim;
    output: TaskExecutionOutput;
  }) => Promise<boolean>;
  defer: (input: {
    claim: TaskExecutionClaim;
    internalError: string;
    retryAfterSeconds: number;
  }) => Promise<boolean>;
  fail: (input: {
    claim: TaskExecutionClaim;
    customerCode: string;
    customerMessage: string;
    internalError: string;
  }) => Promise<boolean>;
  loadEvidence: (
    claim: TaskExecutionClaim,
  ) => Promise<TaskExecutionEvidence>;
  recordPrepublication: (input: {
    branch: string;
    changes: ValidatedWorkspaceChange[];
    claim: TaskExecutionClaim;
    run: PersistedWorkerRun;
  }) => Promise<boolean>;
  renew: (input: {
    claim: TaskExecutionClaim;
    leaseSeconds: number;
  }) => Promise<boolean>;
};

export type TaskExecutor = {
  execute: (input: TaskExecutionInput) => Promise<TaskExecutionOutput>;
};

class TaskExecutionEvidenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TaskExecutionEvidenceError";
    this.code = code;
  }
}

class TaskExecutionLeaseLostError extends Error {
  constructor() {
    super("The task execution lease was lost.");
    this.name = "TaskExecutionLeaseLostError";
  }
}

const requireAdminClient = () => {
  const admin = createAdminClient();

  if (!admin) {
    throw new ControlPlaneError({
      code: "service_unavailable",
      message: "Task execution storage is not configured.",
      status: 503,
    });
  }

  return admin;
};

const requireRpcSuccess = (
  data: boolean | null,
  error: { message: string } | null,
  operation: string,
): boolean => {
  if (error) {
    throw new Error(`${operation}: ${error.message}`);
  }

  return data === true;
};

const mapTaskRow = (row: Record<string, unknown>): AcceptedTaskEvidence => ({
  acceptanceCriteria: String(row.acceptance_criteria),
  description: String(row.description),
  githubRepositoryId: Number(row.github_repository_id),
  id: String(row.id),
  manifestHash: String(row.manifest_hash),
  quoteId: String(row.quote_id),
  repositoryBaseBranch: String(row.repository_base_branch),
  repositoryBindingId: String(row.repository_binding_id),
  repositoryFullName: String(row.repository_full_name),
  repositorySha: String(row.repository_sha),
  repositorySnapshotId: String(row.repository_snapshot_id),
  repositoryUrl: String(row.repository_url),
  status: String(row.status),
  taskSpec: taskContractSchema.parse(row.task_spec),
  title: String(row.title),
  userId: String(row.user_id),
});

const mapQuoteRow = (row: Record<string, unknown>): AcceptedQuoteEvidence => ({
  acceptanceIdempotencyKey:
    typeof row.acceptance_idempotency_key === "string"
      ? row.acceptance_idempotency_key
      : null,
  amountCents: Number(row.amount_cents),
  contractHash: String(row.contract_hash),
  currency: row.currency as "AUD",
  eligibilityDecision: row.eligibility_decision as Record<string, unknown>,
  expiresAt: String(row.expires_at),
  githubRepositoryId: Number(row.github_repository_id),
  id: String(row.id),
  manifestHash: String(row.manifest_hash),
  pricingEvidence: row.pricing_evidence,
  pricingEvidenceHash: String(row.pricing_evidence_hash),
  pricingModelVersion: String(row.pricing_model_version),
  repositoryBaseBranch: String(row.repository_base_branch),
  repositoryBindingId: String(row.repository_binding_id),
  repositoryFullName: String(row.repository_full_name),
  repositorySha: String(row.repository_sha),
  repositorySnapshotId: String(row.repository_snapshot_id),
  repositoryUrl: String(row.repository_url),
  status: String(row.status),
  taskId: typeof row.task_id === "string" ? row.task_id : null,
  taskSpec: taskContractSchema.parse(row.task_spec),
  terms: String(row.terms),
  userId: String(row.user_id),
});

const parseValidatedChanges = (
  value: unknown,
): ValidatedWorkspaceChange[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TaskExecutionEvidenceError(
      "publication_recovery_invalid",
      "Persisted publication recovery evidence is invalid.",
    );
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new TaskExecutionEvidenceError(
        "publication_recovery_invalid",
        "Persisted publication recovery evidence is invalid.",
      );
    }

    const change = entry as Record<string, unknown>;
    const status = change.status;

    if (
      typeof change.path !== "string" ||
      !["added", "deleted", "modified"].includes(String(status)) ||
      (status !== "deleted" &&
        (typeof change.contentBase64 !== "string" ||
          !["100644", "100755"].includes(String(change.mode))))
    ) {
      throw new TaskExecutionEvidenceError(
        "publication_recovery_invalid",
        "Persisted publication recovery evidence is invalid.",
      );
    }

    return {
      ...(typeof change.contentBase64 === "string"
        ? { contentBase64: change.contentBase64 }
        : {}),
      ...(change.mode === "100644" || change.mode === "100755"
        ? { mode: change.mode }
        : {}),
      path: change.path,
      status: status as ValidatedWorkspaceChange["status"],
    };
  });
};

const parseRecovery = (
  row: Record<string, unknown> | null,
): TaskExecutionRecovery | null => {
  if (!row?.change_evidence) {
    return null;
  }

  const evidence = row.change_evidence as Record<string, unknown>;

  if (
    typeof evidence.branch !== "string" ||
    typeof row.agent_id !== "string" ||
    typeof row.run_id !== "string" ||
    typeof row.worker_model !== "string"
  ) {
    throw new TaskExecutionEvidenceError(
      "publication_recovery_invalid",
      "Persisted publication recovery evidence is invalid.",
    );
  }

  return {
    branch: evidence.branch,
    changes: parseValidatedChanges(evidence.changes),
    run: {
      agentId: row.agent_id,
      modelId: row.worker_model,
      output:
        row.worker_output &&
        typeof row.worker_output === "object" &&
        typeof (row.worker_output as Record<string, unknown>).summary ===
          "string"
          ? String(
              (row.worker_output as Record<string, unknown>).summary,
            )
          : null,
      runId: row.run_id,
      usage:
        row.usage && typeof row.usage === "object"
          ? (row.usage as Record<string, unknown>)
          : null,
    },
  };
};

const createTaskExecutionStore = (): TaskExecutionStore => ({
  claim: async ({ batchSize, claimedBy, leaseSeconds }) => {
    const { data, error } = await requireAdminClient().rpc(
      "claim_task_executions",
      {
        p_batch_size: batchSize,
        p_claimed_by: claimedBy,
        p_lease_seconds: leaseSeconds,
      },
    );

    if (error) {
      throw new Error(`Task execution claims failed: ${error.message}`);
    }

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      attemptId: String(row.attempt_id),
      claimCount: Number(row.claim_count),
      claimToken: String(row.claim_token),
      failureCount: Number(row.failure_count),
      leaseExpiresAt: String(row.lease_expires_at),
      taskId: String(row.task_id),
      userId: String(row.user_id),
    }));
  },
  complete: async ({ claim, output }) => {
    const publication = output.publication;
    const { data, error } = await requireAdminClient().rpc(
      "complete_task_execution",
      {
        p_attempt_id: claim.attemptId,
        p_change_evidence: {
          baseSha: publication.baseSha,
          changedFiles: publication.changedFiles,
        },
        p_claim_token: claim.claimToken,
        p_publication_evidence: publication,
      },
    );

    return requireRpcSuccess(data, error, "Task publication persistence failed");
  },
  defer: async ({ claim, internalError, retryAfterSeconds }) => {
    const { data, error } = await requireAdminClient().rpc(
      "defer_task_execution",
      {
        p_attempt_id: claim.attemptId,
        p_claim_token: claim.claimToken,
        p_internal_error: internalError,
        p_retry_after_seconds: retryAfterSeconds,
      },
    );

    return requireRpcSuccess(data, error, "Task retry persistence failed");
  },
  fail: async ({
    claim,
    customerCode,
    customerMessage,
    internalError,
  }) => {
    const { data, error } = await requireAdminClient().rpc(
      "fail_task_execution",
      {
        p_attempt_id: claim.attemptId,
        p_claim_token: claim.claimToken,
        p_customer_error_code: customerCode,
        p_customer_error_message: customerMessage,
        p_internal_error: internalError,
      },
    );

    return requireRpcSuccess(data, error, "Task failure persistence failed");
  },
  loadEvidence: async (claim) => {
    const admin = requireAdminClient();
    const { data: taskData, error: taskError } = await admin
      .from("tasks")
      .select(
        "id, user_id, quote_id, title, description, acceptance_criteria, status, repository_url, repository_sha, repository_binding_id, repository_snapshot_id, manifest_hash, repository_full_name, github_repository_id, repository_base_branch, task_spec",
      )
      .eq("id", claim.taskId)
      .eq("user_id", claim.userId)
      .maybeSingle();

    if (taskError || !taskData) {
      throw new TaskExecutionEvidenceError(
        "task_evidence_missing",
        "The accepted task evidence is unavailable.",
      );
    }

    const task = mapTaskRow(taskData);
    const [
      { data: quoteData, error: quoteError },
      { data: underwritingData, error: underwritingError },
      repository,
      { data: attemptData, error: attemptError },
    ] = await Promise.all([
      admin
        .from("quotes")
        .select(
          "id, user_id, task_id, status, acceptance_idempotency_key, repository_binding_id, repository_snapshot_id, manifest_hash, repository_url, repository_full_name, github_repository_id, repository_base_branch, repository_sha, task_spec, eligibility_decision, amount_cents, currency, terms, pricing_model_version, pricing_evidence, pricing_evidence_hash, expires_at, contract_hash",
        )
        .eq("id", task.quoteId)
        .eq("user_id", claim.userId)
        .maybeSingle(),
      admin
        .from("quote_underwriting")
        .select(
          "quote_id, user_id, repository_binding_id, repository_snapshot_id, manifest_hash, repository_sha, pricing_evidence_hash, pricing_policy_version, estimator_id, estimator_version, analysis_json",
        )
        .eq("quote_id", task.quoteId)
        .eq("user_id", claim.userId)
        .maybeSingle(),
      loadOwnedRepositoryEvidence(
        { apiKeyId: "internal-reconciler", userId: claim.userId },
        task.repositoryBindingId,
      ),
      admin
        .from("task_execution_attempts")
        .select(
          "id, claim_token, agent_id, run_id, worker_model, usage, worker_output, change_evidence",
        )
        .eq("id", claim.attemptId)
        .eq("task_id", claim.taskId)
        .eq("user_id", claim.userId)
        .eq("claim_token", claim.claimToken)
        .maybeSingle(),
    ]);

    if (
      quoteError ||
      !quoteData ||
      underwritingError ||
      !underwritingData ||
      attemptError ||
      !attemptData
    ) {
      throw new TaskExecutionEvidenceError(
        "contract_evidence_missing",
        "The accepted quote evidence is unavailable.",
      );
    }

    const quote = mapQuoteRow(quoteData);
    const { data: installationData, error: installationError } = await admin
      .from("github_app_installations")
      .select(
        "id, user_id, installation_id, app_id, permissions, suspended_at, disconnected_at",
      )
      .eq("id", repository.binding.accessBinding.storedInstallationId)
      .eq("user_id", claim.userId)
      .maybeSingle();

    if (installationError || !installationData) {
      throw new TaskExecutionEvidenceError(
        "repository_access_revoked",
        "Repository access is no longer available.",
      );
    }

    return {
      installation: {
        appId: Number(installationData.app_id),
        disconnectedAt: installationData.disconnected_at,
        id: installationData.id,
        installationId: Number(installationData.installation_id),
        permissions: installationData.permissions as Record<string, string>,
        suspendedAt: installationData.suspended_at,
        userId: installationData.user_id,
      },
      quote,
      recovery: parseRecovery(attemptData),
      repository,
      task,
      underwriting: {
        analysis: underwritingData.analysis_json as UnderwritingEvidence["analysis"],
        estimatorId: underwritingData.estimator_id,
        estimatorVersion: underwritingData.estimator_version,
        manifestHash: underwritingData.manifest_hash,
        pricingEvidenceHash: underwritingData.pricing_evidence_hash,
        pricingPolicyVersion: underwritingData.pricing_policy_version,
        quoteId: underwritingData.quote_id,
        repositoryBindingId: underwritingData.repository_binding_id,
        repositorySha: underwritingData.repository_sha,
        repositorySnapshotId: underwritingData.repository_snapshot_id,
        userId: underwritingData.user_id,
      },
    };
  },
  recordPrepublication: async ({ branch, changes, claim, run }) => {
    const { data, error } = await requireAdminClient().rpc(
      "record_task_execution_prepublication",
      {
        p_agent_id: run.agentId,
        p_attempt_id: claim.attemptId,
        p_change_evidence: { branch, changes },
        p_claim_token: claim.claimToken,
        p_lease_seconds: DEFAULT_LEASE_SECONDS,
        p_run_id: run.runId,
        p_usage: run.usage,
        p_worker_model: run.modelId,
        p_worker_output: run.output
          ? { summary: run.output.slice(0, 4_000) }
          : {},
      },
    );

    return requireRpcSuccess(
      data,
      error,
      "Prepublication evidence persistence failed",
    );
  },
  renew: async ({ claim, leaseSeconds }) => {
    const { data, error } = await requireAdminClient().rpc(
      "renew_task_execution_lease",
      {
        p_attempt_id: claim.attemptId,
        p_claim_token: claim.claimToken,
        p_lease_seconds: leaseSeconds,
      },
    );

    return requireRpcSuccess(data, error, "Task lease renewal failed");
  },
});

const expectedTaskTitle = (task: TaskContract): string =>
  task.description.trim().split("\n", 1)[0]!.slice(0, 160);

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const assertAcceptedEvidence = (
  evidence: TaskExecutionEvidence,
  claim: TaskExecutionClaim,
): void => {
  const { installation, quote, repository, task, underwriting } = evidence;
  const binding = repository.binding;
  const snapshot = repository.snapshot;
  const pricingEvidence = quote.pricingEvidence as {
    estimator?: { id?: string; version?: string };
    estimatorDecision?: string;
  };
  const repositoryIdentity = [
    task.repositoryBindingId === quote.repositoryBindingId,
    task.repositoryBindingId === repository.bindingId,
    task.repositorySnapshotId === quote.repositorySnapshotId,
    task.repositorySnapshotId === repository.snapshotId,
    task.manifestHash === quote.manifestHash,
    task.manifestHash === binding.manifestHash,
    task.manifestHash === snapshot.manifestHash,
    task.repositorySha === quote.repositorySha,
    task.repositorySha === binding.baseSha,
    task.repositorySha === snapshot.commitSha,
    task.repositoryUrl === quote.repositoryUrl,
    task.repositoryUrl === binding.repository.canonicalUrl,
    task.repositoryFullName === quote.repositoryFullName,
    task.repositoryFullName === binding.repository.fullName,
    task.githubRepositoryId === quote.githubRepositoryId,
    task.githubRepositoryId === binding.repository.githubRepositoryId,
    task.repositoryBaseBranch === quote.repositoryBaseBranch,
    task.repositoryBaseBranch === binding.baseBranch,
  ];

  if (
    task.id !== claim.taskId ||
    task.userId !== claim.userId ||
    quote.userId !== claim.userId ||
    repository.userId !== claim.userId ||
    task.quoteId !== quote.id ||
    quote.taskId !== task.id ||
    quote.status !== "approved" ||
    !["starting", "executing"].includes(task.status) ||
    !quote.acceptanceIdempotencyKey ||
    !repositoryIdentity.every(Boolean) ||
    !sameJson(task.taskSpec, quote.taskSpec) ||
    task.description !== task.taskSpec.description ||
    task.acceptanceCriteria !==
      task.taskSpec.acceptanceCriteria.join("\n") ||
    task.title !== expectedTaskTitle(task.taskSpec)
  ) {
    throw new TaskExecutionEvidenceError(
      "accepted_contract_mismatch",
      "The accepted task contract evidence does not match.",
    );
  }

  if (
    underwriting.quoteId !== quote.id ||
    underwriting.userId !== claim.userId ||
    underwriting.repositoryBindingId !== quote.repositoryBindingId ||
    underwriting.repositorySnapshotId !== quote.repositorySnapshotId ||
    underwriting.manifestHash !== quote.manifestHash ||
    underwriting.repositorySha !== quote.repositorySha ||
    underwriting.pricingEvidenceHash !== quote.pricingEvidenceHash ||
    underwriting.pricingPolicyVersion !== quote.pricingModelVersion ||
    underwriting.estimatorId !== pricingEvidence.estimator?.id ||
    underwriting.estimatorVersion !== pricingEvidence.estimator?.version
  ) {
    throw new TaskExecutionEvidenceError(
      "underwriting_evidence_mismatch",
      "The accepted quote underwriting evidence does not match.",
    );
  }

  const calculatedContractHash = createContractHash({
    amountCents: quote.amountCents,
    currency: quote.currency,
    expiresAt: quote.expiresAt,
    pricingEvidence: quote.pricingEvidence,
    pricingEvidenceHash: quote.pricingEvidenceHash,
    pricingModelVersion: quote.pricingModelVersion,
    repositoryEvidence: {
      baseBranch: quote.repositoryBaseBranch,
      baseSha: quote.repositorySha,
      bindingId: quote.repositoryBindingId,
      githubRepositoryId: quote.githubRepositoryId,
      manifestHash: quote.manifestHash,
      repositoryFullName: quote.repositoryFullName,
      repositoryUrl: quote.repositoryUrl,
      snapshotId: quote.repositorySnapshotId,
    },
    repositorySha: quote.repositorySha,
    repositoryUrl: quote.repositoryUrl,
    task: quote.taskSpec,
    terms: quote.terms,
  });

  if (
    calculatedContractHash !== quote.contractHash ||
    quote.currency !== "AUD" ||
    sha256CanonicalJson({
      customer: quote.pricingEvidence,
      policy: SNAPSHOT_PRICING_POLICY,
    }) !== quote.pricingEvidenceHash ||
    quote.eligibilityDecision.eligible !== true ||
    !["accept", "accept_with_conditions"].includes(
      pricingEvidence.estimatorDecision ?? "",
    )
  ) {
    throw new TaskExecutionEvidenceError(
      "quote_contract_mismatch",
      "The accepted quote contract is no longer executable.",
    );
  }

  const currentEligibility = decideTaskEligibility({
    repositorySha: task.repositorySha,
    repositoryUrl: task.repositoryUrl,
    task: task.taskSpec,
  });

  if (!currentEligibility.eligible) {
    throw new TaskExecutionEvidenceError(
      "execution_policy_rejected",
      "The task is outside the current bounded execution policy.",
    );
  }

  if (
    installation.id !== binding.accessBinding.storedInstallationId ||
    installation.userId !== claim.userId ||
    installation.installationId !==
      binding.accessBinding.githubInstallationId ||
    installation.disconnectedAt ||
    installation.suspendedAt ||
    installation.permissions.contents !== "write" ||
    installation.permissions.pull_requests !== "write"
  ) {
    throw new TaskExecutionEvidenceError(
      "repository_access_revoked",
      "Repository access or required permissions are no longer available.",
    );
  }
};

const deriveAllowedPaths = (
  evidence: TaskExecutionEvidence,
): string[] => {
  const manifestFiles = new Map(
    evidence.repository.snapshot.manifest.files.map((file) => [
      file.path,
      file,
    ]),
  );
  const prohibitedText =
    evidence.task.taskSpec.prohibitedChanges.join(" ").toLowerCase();
  const likelyPaths =
    evidence.underwriting.analysis.likelyRelevantFiles?.flatMap(({ path }) =>
      typeof path === "string" ? [path] : [],
    ) ?? [];
  const allowedPaths = [...new Set(likelyPaths)].filter((path) => {
    const file = manifestFiles.get(path);

    if (!file || !["source", "documentation"].includes(file.category)) {
      return false;
    }

    if (
      file.category === "documentation" &&
      /\b(do not|don't|must not)\b.{0,40}\b(document|docs)\b/iu.test(
        prohibitedText,
      )
    ) {
      return false;
    }

    return true;
  });

  if (
    allowedPaths.length === 0 ||
    allowedPaths.length > MAX_ALLOWED_PATHS
  ) {
    throw new TaskExecutionEvidenceError(
      "unsafe_change_scope",
      "The persisted task does not resolve to a safe bounded change scope.",
    );
  }

  return allowedPaths;
};

const assertRecoveryMatchesScope = ({
  allowedPaths,
  baseSha,
  recovery,
  taskIdentity,
}: {
  allowedPaths: string[];
  baseSha: string;
  recovery: TaskExecutionRecovery | null;
  taskIdentity: string;
}): void => {
  if (!recovery) {
    return;
  }

  try {
    assertPersistedWorkspaceChanges({
      allowedPaths,
      changes: recovery.changes,
    });
  } catch {
    throw new TaskExecutionEvidenceError(
      "publication_recovery_invalid",
      "Persisted publication recovery evidence is invalid.",
    );
  }

  const expectedBranch = createPublicationBranch({
    baseSha,
    changes: recovery.changes,
    taskIdentity,
  });

  if (
    recovery.branch !== expectedBranch
  ) {
    throw new TaskExecutionEvidenceError(
      "publication_recovery_invalid",
      "Persisted publication recovery evidence is invalid.",
    );
  }
};

export const buildAcceptedTaskPrompt = (
  task: TaskContract,
  allowedPaths: string[],
): string =>
  [
    `Task:\n${task.description}`,
    "",
    "Acceptance criteria:",
    ...task.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    "Prohibited changes:",
    ...task.prohibitedChanges.map((constraint) => `- ${constraint}`),
    "",
    "Allowed file paths:",
    ...allowedPaths.map((path) => `- ${path}`),
  ].join("\n");

const toPersistedRun = (
  run: IsolatedCursorRunResult,
  modelId: string,
): PersistedWorkerRun => ({
  agentId: run.agentId,
  modelId,
  output: run.output,
  runId: run.runId,
  usage: run.usage as Record<string, unknown> | null,
});

const createTaskExecutor = (): TaskExecutor => ({
  execute: async (input) => {
    const modelId =
      process.env.OUTCOMES_CURSOR_MODEL?.trim() || DEFAULT_MODEL_ID;
    const result = await runGitHubAppWorkerSpike({
      allowedPaths: input.allowedPaths,
      assertLease: input.assertLease,
      baseBranch: input.baseBranch,
      baseSha: input.baseSha,
      expectedRepositoryId: input.repositoryId,
      installationId: input.installationId,
      onPrepublication: async ({ branch, changes, run }) =>
        input.onPrepublication({
          branch,
          changes,
          run: input.recovery?.run ?? toPersistedRun(run, modelId),
        }),
      prompt: input.prompt,
      pullRequestTitle: input.pullRequestTitle,
      recovery: input.recovery
        ? {
            changes: input.recovery.changes,
            run: {
              agentId: input.recovery.run.agentId,
              error: null,
              output: input.recovery.run.output,
              runId: input.recovery.run.runId,
              status: "finished",
              usage:
                input.recovery.run.usage as IsolatedCursorRunResult["usage"],
            },
          }
        : undefined,
      repositoryUrl: input.repositoryUrl,
      signal: input.signal,
      taskIdentity: input.taskIdentity,
    });

    return {
      publication: result.publication,
      run: input.recovery?.run ?? toPersistedRun(result.run, modelId),
    };
  },
});

const serializeError = (error: unknown): string => {
  if (error instanceof Error) {
    return [error.name, error.message, error.stack].filter(Boolean).join("\n");
  }

  return String(error);
};

export const createTaskExecutionOrchestrator = ({
  executor,
  store,
}: {
  executor: TaskExecutor;
  store: TaskExecutionStore;
}) => {
  const processClaim = async (claim: TaskExecutionClaim) => {
    const abortController = new AbortController();
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let heartbeatPending = Promise.resolve();
    let leaseLost = false;
    const renewLease = async () => {
      if (leaseLost) {
        throw new TaskExecutionLeaseLostError();
      }

      let renewed = false;

      try {
        renewed = await store.renew({
          claim,
          leaseSeconds: DEFAULT_LEASE_SECONDS,
        });
      } catch {
        renewed = false;
      }

      if (!renewed) {
        leaseLost = true;
        abortController.abort();
        throw new TaskExecutionLeaseLostError();
      }
    };
    const stopHeartbeat = async () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      await heartbeatPending.catch(() => undefined);
    };

    try {
      await renewLease();
      heartbeatTimer = setInterval(() => {
        heartbeatPending = heartbeatPending
          .then(renewLease)
          .catch(() => undefined);
      }, HEARTBEAT_INTERVAL_MILLISECONDS);
      heartbeatTimer.unref();

      const evidence = await store.loadEvidence(claim);
      assertAcceptedEvidence(evidence, claim);
      const allowedPaths = deriveAllowedPaths(evidence);
      assertRecoveryMatchesScope({
        allowedPaths,
        baseSha: evidence.task.repositorySha,
        recovery: evidence.recovery,
        taskIdentity: evidence.quote.contractHash,
      });
      const output = await executor.execute({
        allowedPaths,
        assertLease: renewLease,
        baseBranch: evidence.task.repositoryBaseBranch,
        baseSha: evidence.task.repositorySha,
        installationId: evidence.installation.installationId,
        onPrepublication: async ({ branch, changes, run }) => {
          const persisted = await store.recordPrepublication({
            branch,
            changes,
            claim,
            run,
          });

          if (!persisted) {
            leaseLost = true;
            abortController.abort();
            throw new TaskExecutionLeaseLostError();
          }
        },
        prompt: buildAcceptedTaskPrompt(
          evidence.task.taskSpec,
          allowedPaths,
        ),
        pullRequestTitle: `Outcomes: ${evidence.task.title.slice(0, 72)}`,
        repositoryId: evidence.task.githubRepositoryId,
        repositoryUrl: evidence.task.repositoryUrl,
        recovery: evidence.recovery,
        signal: abortController.signal,
        taskIdentity: evidence.quote.contractHash,
      });
      await renewLease();
      await stopHeartbeat();
      const completed = await store.complete({ claim, output });

      if (!completed) {
        throw new TaskExecutionLeaseLostError();
      }

      return { status: "succeeded" as const, taskId: claim.taskId };
    } catch (error) {
      await stopHeartbeat();

      if (
        leaseLost ||
        error instanceof TaskExecutionLeaseLostError
      ) {
        return {
          code: "execution_lease_lost",
          status: "lease_lost" as const,
          taskId: claim.taskId,
        };
      }

      const customerCode =
        error instanceof TaskExecutionEvidenceError
          ? error.code
          : error instanceof PermanentTaskExecutionError
            ? error.code
          : "worker_execution_failed";
      const customerMessage =
        error instanceof TaskExecutionEvidenceError
          ? error.message
          : error instanceof PermanentTaskExecutionError
            ? error.customerMessage
          : "The isolated worker encountered a temporary failure.";
      const internalError = serializeError(error);

      try {
        await renewLease();
      } catch {
        return {
          code: "execution_lease_lost",
          status: "lease_lost" as const,
          taskId: claim.taskId,
        };
      }

      const shouldTerminalize =
        error instanceof TaskExecutionEvidenceError ||
        error instanceof PermanentTaskExecutionError ||
        claim.failureCount + 1 >= MAX_EXECUTION_FAILURES;
      const persisted = shouldTerminalize
        ? await store.fail({
          claim,
          customerCode,
          customerMessage:
            error instanceof TaskExecutionEvidenceError ||
            error instanceof PermanentTaskExecutionError
              ? customerMessage
              : "The isolated worker could not complete this task after bounded retries.",
          internalError,
        })
        : await store.defer({
            claim,
            internalError,
            retryAfterSeconds: Math.min(
              300,
              30 * 2 ** claim.failureCount,
            ),
          });

      if (!persisted) {
        return {
          code: "execution_lease_lost",
          status: "lease_lost" as const,
          taskId: claim.taskId,
        };
      }

      return {
        code: customerCode,
        status: shouldTerminalize
          ? ("failed" as const)
          : ("retry_scheduled" as const),
        taskId: claim.taskId,
      };
    } finally {
      await stopHeartbeat();
    }
  };

  return async ({
    batchSize,
    claimedBy,
    leaseSeconds = DEFAULT_LEASE_SECONDS,
  }: {
    batchSize: number;
    claimedBy: string;
    leaseSeconds?: number;
  }) => {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
      throw new Error("A positive reconciliation batch size is required.");
    }

    const claims = await store.claim({
      batchSize: 1,
      claimedBy,
      leaseSeconds,
    });
    const results = [];

    for (const claim of claims) {
      results.push(await processClaim(claim));
    }

    return { claimed: claims.length, results };
  };
};

export const reconcileTaskExecutions = createTaskExecutionOrchestrator({
  executor: createTaskExecutor(),
  store: createTaskExecutionStore(),
});
