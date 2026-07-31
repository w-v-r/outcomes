import "server-only";

import { isDeepStrictEqual } from "node:util";

import { type CustomerPrincipal } from "@/lib/api-keys/service";
import { createContractHash } from "@/lib/pricing/quote-policy";
import {
  SNAPSHOT_PRICING_POLICY,
  type CustomerPricingEvidence,
  type SnapshotUnderwriting,
} from "@/lib/pricing/snapshot-policy";
import {
  loadOwnedRepositoryEvidence,
  type OwnedRepositoryEvidence,
} from "@/lib/repositories/evidence";
import { createAdminClient } from "@/lib/supabase/admin";

import { evaluateSnapshotTask } from "./assessments";
import { ControlPlaneError } from "./errors";
import { createInternalTaskAnalysisId } from "./internal-task-id";
import { type BindingQuoteInput } from "./schemas";

type SnapshotTaskEvaluation = Awaited<
  ReturnType<typeof evaluateSnapshotTask>
>;

export type SnapshotQuoteRow = {
  amount_cents: number;
  contract_hash: string;
  currency: "AUD";
  eligibility_decision: {
    code: string;
    conditions?: string[];
    eligible: boolean;
    estimatorDecision?: CustomerPricingEvidence["estimatorDecision"];
    normalizedRepositoryUrl?: string | null;
    reason?: string;
  };
  expires_at: string;
  github_repository_id: number;
  id: string;
  manifest_hash: string;
  pricing_evidence: CustomerPricingEvidence;
  pricing_evidence_hash: string;
  pricing_model_version: string;
  repository_base_branch: string;
  repository_binding_id: string;
  repository_full_name: string;
  repository_sha: string;
  repository_snapshot_id: string;
  repository_url: string;
  request_id: string;
  status: string;
  task_id: string | null;
  task_spec: BindingQuoteInput["task"];
  terms: string;
};

export type CustomerSnapshotQuote = {
  amount_cents: number;
  contract_hash: string;
  currency: "AUD";
  eligibility: SnapshotQuoteRow["eligibility_decision"];
  expires_at: string;
  id: string;
  pricing: CustomerPricingEvidence;
  pricing_evidence_hash: string;
  pricing_model_version: string;
  replayed: boolean;
  repository: {
    base_branch: string;
    base_sha: string;
    binding_id: string;
    full_name: string;
    github_repository_id: number;
    manifest_hash: string;
    snapshot_id: string;
    url: string;
  };
  repository_sha: string;
  repository_url: string;
  status: "accepted" | "expired" | "pending" | "rejected";
  task: BindingQuoteInput["task"];
  task_id: string | null;
  terms: string;
};

export type SnapshotQuoteStore = {
  findByRequest: (input: {
    requestId: string;
    userId: string;
  }) => Promise<SnapshotQuoteRow | null>;
  persist: (input: {
    analysis: unknown;
    estimate: unknown;
    quote: Omit<SnapshotQuoteRow, "id" | "task_id">;
    underwriting: SnapshotUnderwriting;
    userId: string;
  }) => Promise<{ created: boolean; row: SnapshotQuoteRow }>;
};

type SnapshotQuoteDependencies = {
  evaluateTask?: typeof evaluateSnapshotTask;
  loadEvidence: (
    principal: CustomerPrincipal,
    bindingId: string,
  ) => Promise<OwnedRepositoryEvidence>;
  now: () => Date;
  store: SnapshotQuoteStore;
};

export const decideSnapshotQuoteEligibility = ({
  estimatorDecision,
  executionConditions,
  executionEligibility,
  safety,
}: {
  estimatorDecision: CustomerPricingEvidence["estimatorDecision"];
  executionConditions: string[];
  executionEligibility: SnapshotTaskEvaluation["executionEligibility"];
  safety: SnapshotTaskEvaluation["safety"];
}) => {
  if (!safety.safe) {
    return {
      code: safety.code,
      eligible: false as const,
      estimatorDecision,
      normalizedRepositoryUrl:
        executionEligibility.normalizedRepositoryUrl,
      reason: safety.reason,
    };
  }

  if (!executionEligibility.eligible) {
    return {
      ...executionEligibility,
      estimatorDecision,
    };
  }

  if (
    estimatorDecision === "decompose" ||
    estimatorDecision === "decline"
  ) {
    return {
      code: `estimator_${estimatorDecision}`,
      eligible: false as const,
      estimatorDecision,
      normalizedRepositoryUrl:
        executionEligibility.normalizedRepositoryUrl,
      reason:
        estimatorDecision === "decompose"
          ? "The task must be decomposed into a smaller bounded contract before fixed-price execution."
          : "The estimator declined this task for fixed-price execution.",
    };
  }

  return {
    ...executionEligibility,
    ...(estimatorDecision === "accept_with_conditions"
      ? { conditions: executionConditions }
      : {}),
    estimatorDecision,
  };
};

const SNAPSHOT_QUOTE_SELECT =
  "id, request_id, repository_binding_id, repository_snapshot_id, manifest_hash, repository_url, repository_full_name, github_repository_id, repository_base_branch, repository_sha, task_spec, eligibility_decision, amount_cents, currency, terms, pricing_model_version, pricing_evidence, pricing_evidence_hash, status, expires_at, contract_hash, task_id";

const createSnapshotQuoteStore = (): SnapshotQuoteStore => {
  const admin = createAdminClient();

  if (!admin) {
    throw new ControlPlaneError({
      code: "service_unavailable",
      message: "The control plane is not configured.",
      status: 503,
    });
  }

  const findByRequest: SnapshotQuoteStore["findByRequest"] = async ({
    requestId,
    userId,
  }) => {
    const { data, error } = await admin
      .from("quotes")
      .select(SNAPSHOT_QUOTE_SELECT)
      .eq("user_id", userId)
      .eq("request_id", requestId)
      .maybeSingle();

    if (error) {
      throw new ControlPlaneError({
        code: "database_error",
        message: "The quote could not be loaded.",
        status: 500,
      });
    }

    const row = (data as SnapshotQuoteRow | null) ?? null;

    if (!row?.repository_binding_id) {
      return row;
    }

    const { data: underwriting, error: underwritingError } =
      await admin
        .from("quote_underwriting")
        .select("quote_id")
        .eq("quote_id", row.id)
        .eq("user_id", userId)
        .eq("repository_binding_id", row.repository_binding_id)
        .eq("repository_snapshot_id", row.repository_snapshot_id)
        .eq("manifest_hash", row.manifest_hash)
        .eq("pricing_evidence_hash", row.pricing_evidence_hash)
        .eq("pricing_policy_version", row.pricing_model_version)
        .maybeSingle();

    if (underwritingError || !underwriting) {
      throw new ControlPlaneError({
        code: "invalid_quote_underwriting",
        message: "The quote has no matching underwriting evidence.",
        status: 409,
      });
    }

    return row;
  };

  return {
    findByRequest,
    persist: async ({
      analysis,
      estimate,
      quote,
      underwriting,
      userId,
    }) => {
      const { data, error } = await admin.rpc(
        "create_snapshot_quote_with_underwriting",
        {
          p_quote: quote,
          p_underwriting: {
            analysis_json: analysis,
            estimate_json: estimate,
            estimator_id: quote.pricing_evidence.estimator.id,
            estimator_version:
              quote.pricing_evidence.estimator.version,
            internal_budget_usd_micros: Math.ceil(
              underwriting.internalBudgetUsd * 1_000_000,
            ),
            policy_components_json: underwriting,
            predicted_cost_usd_micros: Math.ceil(
              underwriting.predictedWorkerHighUsd * 1_000_000,
            ),
            rate_card_version: "composer-2.5:2026-07-25",
            risk_multiplier: underwriting.retryRiskMultiplier,
            usd_to_aud_rate: SNAPSHOT_PRICING_POLICY.usdToAudRate,
          },
          p_user_id: userId,
        },
      );

      if (error) {
        throw new ControlPlaneError({
          code: "database_error",
          message: "The atomic quote contract could not be persisted.",
          status: 500,
        });
      }

      const result = (
        data as Array<{ created: boolean; quote_id: string }> | null
      )?.[0];
      const quoteRow = await findByRequest({
        requestId: quote.request_id,
        userId,
      });

      if (!result || !quoteRow || quoteRow.id !== result.quote_id) {
        throw new ControlPlaneError({
          code: "database_error",
          message: "The atomic quote contract could not be loaded.",
          status: 500,
        });
      }

      return { created: result.created, row: quoteRow };
    },
  };
};

const projectQuote = (
  row: SnapshotQuoteRow,
  replayed: boolean,
): CustomerSnapshotQuote => ({
  amount_cents: row.amount_cents,
  contract_hash: row.contract_hash,
  currency: row.currency,
  eligibility: row.eligibility_decision,
  expires_at: row.expires_at,
  id: row.id,
  pricing: row.pricing_evidence,
  pricing_evidence_hash: row.pricing_evidence_hash,
  pricing_model_version: row.pricing_model_version,
  replayed,
  repository: {
    base_branch: row.repository_base_branch,
    base_sha: row.repository_sha,
    binding_id: row.repository_binding_id,
    full_name: row.repository_full_name,
    github_repository_id: row.github_repository_id,
    manifest_hash: row.manifest_hash,
    snapshot_id: row.repository_snapshot_id,
    url: row.repository_url,
  },
  repository_sha: row.repository_sha,
  repository_url: row.repository_url,
  status:
    row.status === "approved"
      ? "accepted"
      : row.status === "expired"
        ? "expired"
        : row.status === "rejected"
          ? "rejected"
          : "pending",
  task: row.task_spec,
  task_id: row.task_id,
  terms: row.terms,
});

export const createSnapshotQuoteService = (
  dependencies: SnapshotQuoteDependencies,
) => {
  return async (
    principal: CustomerPrincipal,
    input: BindingQuoteInput,
  ): Promise<CustomerSnapshotQuote> => {
    const existing = await dependencies.store.findByRequest({
      requestId: input.idempotency_key,
      userId: principal.userId,
    });

    if (existing) {
      if (
        existing.repository_binding_id !==
          input.repository_binding_id ||
        !isDeepStrictEqual(existing.task_spec, input.task)
      ) {
        throw new ControlPlaneError({
          code: "idempotency_conflict",
          message:
            "This idempotency key was already used for a different quote request.",
          status: 409,
        });
      }

      return projectQuote(existing, true);
    }

    const evidence = await dependencies.loadEvidence(
      principal,
      input.repository_binding_id,
    );
    const evaluation = await (
      dependencies.evaluateTask ?? evaluateSnapshotTask
    )({
      evidence,
      task: input.task,
      taskId: createInternalTaskAnalysisId({
        idempotencyKey: input.idempotency_key,
        repositoryBindingId: input.repository_binding_id,
        scope: "quote",
      }),
    });
    const pricingDecisionMatchesEstimate =
      evaluation.pricing.customer.estimatorDecision ===
        evaluation.estimate.decision &&
      (evaluation.estimate.decision === "accept_with_conditions"
        ? evaluation.pricing.customer.executionConditions.length > 0
        : evaluation.pricing.customer.executionConditions.length === 0);

    if (!pricingDecisionMatchesEstimate) {
      throw new ControlPlaneError({
        code: "invalid_pricing_evidence",
        message: "The estimator decision evidence is inconsistent.",
        status: 500,
      });
    }

    const eligibility = decideSnapshotQuoteEligibility({
      estimatorDecision: evaluation.estimate.decision,
      executionConditions:
        evaluation.pricing.customer.executionConditions,
      executionEligibility: evaluation.executionEligibility,
      safety: evaluation.safety,
    });
    const expiresAt = new Date(
      dependencies.now().getTime() +
        SNAPSHOT_PRICING_POLICY.quoteLifetimeMinutes * 60_000,
    ).toISOString();
    const pricingModelVersion =
      evaluation.pricing.customer.policyVersion;
    const terms = eligibility.eligible
      ? [
          "Fixed sandbox price for the immutable repository snapshot. Accrue only after trusted allowlisted verification; charge the stored payment method in a batch when the outstanding verified balance reaches AUD $10.",
          ...(eligibility.conditions ?? []),
        ].join(" ")
      : eligibility.reason;
    const repositoryEvidence = {
      baseBranch: evidence.binding.baseBranch,
      baseSha: evidence.binding.baseSha,
      bindingId: evidence.bindingId,
      githubRepositoryId:
        evidence.binding.repository.githubRepositoryId,
      manifestHash: evidence.binding.manifestHash,
      repositoryFullName: evidence.binding.repository.fullName,
      repositoryUrl: evidence.binding.repository.canonicalUrl,
      snapshotId: evidence.snapshotId,
    };
    const contractHash = createContractHash({
      amountCents: evaluation.pricing.underwriting.fixedPriceCents,
      currency: "AUD",
      expiresAt,
      pricingEvidence: {
        ...evaluation.pricing.customer,
      },
      pricingEvidenceHash: evaluation.pricing.evidenceHash,
      pricingModelVersion,
      repositoryEvidence,
      repositorySha: evidence.binding.baseSha,
      repositoryUrl: evidence.binding.repository.canonicalUrl,
      task: input.task,
      terms,
    });
    const quote = {
      amount_cents: evaluation.pricing.underwriting.fixedPriceCents,
      contract_hash: contractHash,
      currency: "AUD" as const,
      eligibility_decision: eligibility,
      expires_at: expiresAt,
      github_repository_id:
        evidence.binding.repository.githubRepositoryId,
      manifest_hash: evidence.binding.manifestHash,
      pricing_evidence: evaluation.pricing.customer,
      pricing_evidence_hash: evaluation.pricing.evidenceHash,
      pricing_model_version: pricingModelVersion,
      repository_base_branch: evidence.binding.baseBranch,
      repository_binding_id: evidence.bindingId,
      repository_full_name: evidence.binding.repository.fullName,
      repository_sha: evidence.binding.baseSha,
      repository_snapshot_id: evidence.snapshotId,
      repository_url: evidence.binding.repository.canonicalUrl,
      request_id: input.idempotency_key,
      status: eligibility.eligible ? "pending" : "rejected",
      task_spec: input.task,
      terms,
    };
    const persistence = await dependencies.store.persist({
      analysis: evaluation.analysis,
      estimate: evaluation.estimate,
      quote,
      underwriting: evaluation.pricing.underwriting,
      userId: principal.userId,
    });

    if (
      persistence.row.repository_binding_id !==
        input.repository_binding_id ||
      !isDeepStrictEqual(persistence.row.task_spec, input.task)
    ) {
      throw new ControlPlaneError({
        code: "idempotency_conflict",
        message:
          "This idempotency key was concurrently used for a different quote request.",
        status: 409,
      });
    }

    return projectQuote(persistence.row, !persistence.created);
  };
};

export const createSnapshotQuote = async (
  principal: CustomerPrincipal,
  input: BindingQuoteInput,
): Promise<CustomerSnapshotQuote> =>
  createSnapshotQuoteService({
    loadEvidence: loadOwnedRepositoryEvidence,
    now: () => new Date(),
    store: createSnapshotQuoteStore(),
  })(principal, input);
