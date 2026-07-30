import "server-only";

import { isDeepStrictEqual } from "node:util";

import { type CustomerPrincipal } from "@/lib/api-keys/service";
import { decideSnapshotTaskEligibility } from "@/lib/pricing/eligibility";
import { estimateTaskCost } from "@/lib/pricing/estimator";
import { HACKATHON_MODEL_RATE } from "@/lib/pricing/rate-card";
import {
  deriveSnapshotPricing,
  type CustomerPricingEvidence,
  type SnapshotUnderwriting,
} from "@/lib/pricing/snapshot-policy";
import { analyzeTask } from "@/lib/pricing/task-analysis";
import { assessTaskSafety } from "@/lib/pricing/task-safety";
import {
  type TaskAnalysis,
  type TaskEstimate,
} from "@/lib/pricing/domain";
import {
  loadOwnedRepositoryEvidence,
  type OwnedRepositoryEvidence,
} from "@/lib/repositories/evidence";
import { sha256CanonicalJson } from "@/lib/repositories/hash";
import { createAdminClient } from "@/lib/supabase/admin";

import { ControlPlaneError } from "./errors";
import { createInternalTaskAnalysisId } from "./internal-task-id";
import {
  createAssessmentInputSchema,
  type CreateAssessmentInput,
} from "./schemas";

export type AssessmentRow = {
  created_at: string;
  customer_factors: string[];
  decision: "accept" | "accept_with_conditions" | "decompose" | "decline";
  evidence_hash: string;
  execution_eligibility: {
    code: string;
    eligible: boolean;
    reason?: string;
  };
  github_repository_id: number;
  id: string;
  manifest_hash: string;
  pricing_evidence: CustomerPricingEvidence;
  pricing_evidence_hash: string;
  repository_base_branch: string;
  repository_binding_id: string;
  repository_full_name: string;
  repository_sha: string;
  repository_snapshot_id: string;
  repository_url: string;
  request_fingerprint: string;
  source_content_hash: string | null;
  source_evidence: CreateAssessmentInput["source"] | null;
  task_spec: CreateAssessmentInput["task"];
};

export type CustomerAssessment = {
  accepted: false;
  confidence: CustomerPricingEvidence["confidence"];
  created_at: string;
  decision: AssessmentRow["decision"];
  evidence_hash: string;
  execution_eligibility: AssessmentRow["execution_eligibility"];
  id: string;
  pricing: CustomerPricingEvidence;
  pricing_evidence_hash: string;
  replayed: boolean;
  repository: {
    base_branch: string;
    base_sha: string;
    binding_id: string;
    full_name: string;
    manifest_hash: string;
    snapshot_id: string;
    url: string;
  };
  source: null | {
    content_sha256: string;
    issue_id: string;
    issue_url: string;
    project_id: string;
    provider: "linear";
    team_id: string;
    workspace_id: string;
  };
  task: CreateAssessmentInput["task"];
};

export type AssessmentStore = {
  findByRequest: (input: {
    requestId: string;
    userId: string;
  }) => Promise<AssessmentRow | null>;
  persist: (input: {
    analysis: TaskAnalysis;
    assessment: Omit<AssessmentRow, "created_at" | "id">;
    estimate: TaskEstimate;
    requestId: string;
    taskHash: string;
    underwriting: SnapshotUnderwriting;
    userId: string;
  }) => Promise<{ created: boolean; row: AssessmentRow }>;
};

type AssessmentDependencies = {
  loadEvidence: (
    principal: CustomerPrincipal,
    bindingId: string,
  ) => Promise<OwnedRepositoryEvidence>;
  store: AssessmentStore;
};

const ASSESSMENT_SELECT =
  "id, created_at, repository_binding_id, repository_snapshot_id, manifest_hash, repository_url, repository_full_name, github_repository_id, repository_base_branch, repository_sha, task_spec, source_evidence, source_content_hash, request_fingerprint, decision, execution_eligibility, customer_factors, pricing_evidence, pricing_evidence_hash, evidence_hash";

const createAssessmentStore = (): AssessmentStore => {
  const admin = createAdminClient();

  if (!admin) {
    throw new ControlPlaneError({
      code: "service_unavailable",
      message: "Assessment storage is not configured.",
      status: 503,
    });
  }

  const findByRequest: AssessmentStore["findByRequest"] = async ({
    requestId,
    userId,
  }) => {
    const { data, error } = await admin
      .from("assessments")
      .select(ASSESSMENT_SELECT)
      .eq("user_id", userId)
      .eq("request_id", requestId)
      .maybeSingle();

    if (error) {
      throw new ControlPlaneError({
        code: "database_error",
        message: "The assessment could not be loaded.",
        status: 500,
      });
    }

    return (data as AssessmentRow | null) ?? null;
  };

  return {
    findByRequest,
    persist: async ({
      analysis,
      assessment,
      estimate,
      requestId,
      taskHash,
      underwriting,
      userId,
    }) => {
      const { data, error } = await admin
        .from("assessments")
        .insert({
          analysis_json: analysis,
          customer_factors: assessment.customer_factors,
          decision: assessment.decision,
          evidence_hash: assessment.evidence_hash,
          estimate_json: estimate,
          execution_eligibility: assessment.execution_eligibility,
          github_repository_id: assessment.github_repository_id,
          manifest_hash: assessment.manifest_hash,
          pricing_evidence: assessment.pricing_evidence,
          pricing_evidence_hash: assessment.pricing_evidence_hash,
          pricing_policy_version:
            assessment.pricing_evidence.policyVersion,
          repository_base_branch: assessment.repository_base_branch,
          repository_binding_id: assessment.repository_binding_id,
          repository_full_name: assessment.repository_full_name,
          repository_sha: assessment.repository_sha,
          repository_snapshot_id:
            assessment.repository_snapshot_id,
          repository_url: assessment.repository_url,
          request_fingerprint: assessment.request_fingerprint,
          request_id: requestId,
          source_content_hash: assessment.source_content_hash,
          source_evidence: assessment.source_evidence,
          task_hash: taskHash,
          task_spec: assessment.task_spec,
          underwriting_json: underwriting,
          user_id: userId,
        })
        .select(ASSESSMENT_SELECT)
        .single();

      if (!error && data) {
        return { created: true, row: data as AssessmentRow };
      }

      if (error?.code === "23505") {
        const concurrent = await findByRequest({ requestId, userId });

        if (concurrent) {
          return { created: false, row: concurrent };
        }
      }

      throw new ControlPlaneError({
        code: "database_error",
        message: "The assessment could not be persisted.",
        status: 500,
      });
    },
  };
};

const projectAssessment = (
  row: AssessmentRow,
  replayed: boolean,
): CustomerAssessment => ({
  accepted: false,
  confidence: row.pricing_evidence.confidence,
  created_at: row.created_at,
  decision: row.decision,
  evidence_hash: row.evidence_hash,
  execution_eligibility: row.execution_eligibility,
  id: row.id,
  pricing: row.pricing_evidence,
  pricing_evidence_hash: row.pricing_evidence_hash,
  replayed,
  repository: {
    base_branch: row.repository_base_branch,
    base_sha: row.repository_sha,
    binding_id: row.repository_binding_id,
    full_name: row.repository_full_name,
    manifest_hash: row.manifest_hash,
    snapshot_id: row.repository_snapshot_id,
    url: row.repository_url,
  },
  source:
    row.source_evidence && row.source_content_hash
      ? row.source_evidence
      : null,
  task: row.task_spec,
});

export const evaluateSnapshotTask = async ({
  evidence,
  task,
  taskId,
}: {
  evidence: OwnedRepositoryEvidence;
  task: CreateAssessmentInput["task"];
  taskId: string;
}) => {
  const taskRequest = { id: taskId, ...task };
  const analysis = analyzeTask(taskRequest, evidence.snapshot.manifest);
  const estimate = await estimateTaskCost({
    analysis,
    manifest: evidence.snapshot.manifest,
    modelRate: HACKATHON_MODEL_RATE,
    task: taskRequest,
  });
  const safety = assessTaskSafety(task);
  const executionEligibility = decideSnapshotTaskEligibility({
    repositorySha: evidence.binding.baseSha,
    repositoryUrl: evidence.binding.repository.canonicalUrl,
    task,
  });
  const pricing = deriveSnapshotPricing({
    analysis,
    estimate,
    manifest: evidence.snapshot.manifest,
  });

  return {
    analysis,
    decision: safety.safe ? estimate.decision : ("decline" as const),
    estimate,
    executionEligibility,
    pricing,
    safety,
  };
};

export const createAssessTaskService = (
  dependencies: AssessmentDependencies,
) => {
  return async (
    principal: CustomerPrincipal,
    inputValue: CreateAssessmentInput,
  ): Promise<CustomerAssessment> => {
    const input = createAssessmentInputSchema.parse(inputValue);
    const requestFingerprint = sha256CanonicalJson({
      repositoryBindingId: input.repository_binding_id,
      source: input.source ?? null,
      task: input.task,
    });
    const existing = await dependencies.store.findByRequest({
      requestId: input.idempotency_key,
      userId: principal.userId,
    });

    if (existing) {
      if (existing.request_fingerprint !== requestFingerprint) {
        throw new ControlPlaneError({
          code: "idempotency_conflict",
          message:
            "This idempotency key was already used for a different assessment request.",
          status: 409,
        });
      }

      return projectAssessment(existing, true);
    }

    const evidence = await dependencies.loadEvidence(
      principal,
      input.repository_binding_id,
    );
    const evaluation = await evaluateSnapshotTask({
      evidence,
      task: input.task,
      taskId: createInternalTaskAnalysisId({
        idempotencyKey: input.idempotency_key,
        repositoryBindingId: input.repository_binding_id,
        scope: "assessment",
      }),
    });
    const taskHash = sha256CanonicalJson(input.task);
    const sourceContentHash = input.source?.content_sha256 ?? null;
    const evidenceHash = sha256CanonicalJson({
      manifestHash: evidence.binding.manifestHash,
      pricingEvidenceHash: evaluation.pricing.evidenceHash,
      repositoryBindingId: evidence.bindingId,
      repositorySnapshotId: evidence.snapshotId,
      sourceContentHash,
      taskHash,
    });
    const assessment = {
      customer_factors: evaluation.pricing.customer.factors,
      decision: evaluation.decision,
      evidence_hash: evidenceHash,
      execution_eligibility: evaluation.executionEligibility,
      github_repository_id:
        evidence.binding.repository.githubRepositoryId,
      manifest_hash: evidence.binding.manifestHash,
      pricing_evidence: evaluation.pricing.customer,
      pricing_evidence_hash: evaluation.pricing.evidenceHash,
      repository_base_branch: evidence.binding.baseBranch,
      repository_binding_id: evidence.bindingId,
      repository_full_name: evidence.binding.repository.fullName,
      repository_sha: evidence.binding.baseSha,
      repository_snapshot_id: evidence.snapshotId,
      repository_url: evidence.binding.repository.canonicalUrl,
      request_fingerprint: requestFingerprint,
      source_content_hash: sourceContentHash,
      source_evidence: input.source ?? null,
      task_spec: input.task,
    };
    const persistence = await dependencies.store.persist({
      analysis: evaluation.analysis,
      assessment,
      estimate: evaluation.estimate,
      requestId: input.idempotency_key,
      taskHash,
      underwriting: evaluation.pricing.underwriting,
      userId: principal.userId,
    });

    if (
      !isDeepStrictEqual(
        persistence.row.request_fingerprint,
        requestFingerprint,
      )
    ) {
      throw new ControlPlaneError({
        code: "idempotency_conflict",
        message:
          "This idempotency key was concurrently used for a different assessment request.",
        status: 409,
      });
    }

    return projectAssessment(
      persistence.row,
      !persistence.created,
    );
  };
};

export const assessTask = async (
  principal: CustomerPrincipal,
  input: CreateAssessmentInput,
): Promise<CustomerAssessment> =>
  createAssessTaskService({
    loadEvidence: loadOwnedRepositoryEvidence,
    store: createAssessmentStore(),
  })(principal, input);
