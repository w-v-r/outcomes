import "server-only";

import { isDeepStrictEqual } from "node:util";

import { type CustomerPrincipal } from "@/lib/api-keys/service";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  HACKATHON_MODEL_RATE,
} from "@/lib/pricing/rate-card";
import {
  HACKATHON_PRICING_POLICY,
  createContractHash,
  deriveQuote,
} from "@/lib/pricing/quote-policy";
import { decideTaskEligibility } from "@/lib/pricing/eligibility";
import { estimateTaskCost } from "@/lib/pricing/estimator";
import {
  FIXTURE_MANIFEST,
  normalizeGitHubRepositoryUrl,
} from "@/lib/pricing/registry";
import { analyzeTask } from "@/lib/pricing/task-analysis";

import { ControlPlaneError } from "./errors";
import { type CreateQuoteInput } from "./schemas";

type QuoteRow = {
  amount_cents: number;
  contract_hash: string;
  currency: "AUD";
  eligibility_decision: {
    code: string;
    eligible: boolean;
    reason?: string;
  };
  expires_at: string;
  id: string;
  pricing_model_version: string;
  repository_sha: string;
  repository_url: string;
  request_id: string;
  status: string;
  task_id: string | null;
  task_spec: CreateQuoteInput["task"];
  terms: string;
};

export type CustomerQuote = {
  amount_cents: number;
  contract_hash: string;
  currency: "AUD";
  eligibility: QuoteRow["eligibility_decision"];
  expires_at: string;
  id: string;
  pricing_model_version: string;
  replayed: boolean;
  repository_sha: string;
  repository_url: string;
  status: "accepted" | "pending" | "rejected";
  task: CreateQuoteInput["task"];
  task_id: string | null;
  terms: string;
};

const QUOTE_SELECT =
  "id, request_id, repository_url, repository_sha, task_spec, eligibility_decision, amount_cents, currency, terms, pricing_model_version, status, expires_at, contract_hash, task_id";

const requireAdminClient = () => {
  const supabase = createAdminClient();

  if (!supabase) {
    throw new ControlPlaneError({
      code: "service_unavailable",
      message: "The control plane is not configured.",
      status: 503,
    });
  }

  return supabase;
};

const projectQuote = (
  row: QuoteRow,
  replayed: boolean,
): CustomerQuote => ({
  amount_cents: row.amount_cents,
  contract_hash: row.contract_hash,
  currency: row.currency,
  eligibility: row.eligibility_decision,
  expires_at: row.expires_at,
  id: row.id,
  pricing_model_version: row.pricing_model_version,
  replayed,
  repository_sha: row.repository_sha,
  repository_url: row.repository_url,
  status:
    row.status === "approved"
      ? "accepted"
      : row.status === "rejected"
        ? "rejected"
        : "pending",
  task: row.task_spec,
  task_id: row.task_id,
  terms: row.terms,
});

const getExistingQuote = async (
  userId: string,
  requestId: string,
): Promise<QuoteRow | null> => {
  const { data, error } = await requireAdminClient()
    .from("quotes")
    .select(QUOTE_SELECT)
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

  return (data as QuoteRow | null) ?? null;
};

const replayExistingQuote = (
  existingQuote: QuoteRow,
  input: CreateQuoteInput,
) => {
  const sameRequest =
    existingQuote.repository_url ===
      (normalizeGitHubRepositoryUrl(input.repository_url) ??
        input.repository_url) &&
    existingQuote.repository_sha.toLowerCase() ===
      input.repository_sha.toLowerCase() &&
    isDeepStrictEqual(existingQuote.task_spec, input.task);

  if (!sameRequest) {
    throw new ControlPlaneError({
      code: "idempotency_conflict",
      message:
        "This idempotency key was already used for a different quote request.",
      status: 409,
    });
  }

  return projectQuote(existingQuote, true);
};

export const createQuote = async (
  principal: CustomerPrincipal,
  input: CreateQuoteInput,
): Promise<CustomerQuote> => {
  const existingQuote = await getExistingQuote(
    principal.userId,
    input.idempotency_key,
  );

  if (existingQuote) {
    return replayExistingQuote(existingQuote, input);
  }

  const eligibility = decideTaskEligibility({
    repositorySha: input.repository_sha,
    repositoryUrl: input.repository_url,
    task: input.task,
  });
  const supabase = requireAdminClient();

  if (!eligibility.eligible) {
    const expiresAt = new Date().toISOString();
    const repositoryUrl =
      eligibility.normalizedRepositoryUrl ?? input.repository_url;
    const contractHash = createContractHash({
      amountCents: HACKATHON_PRICING_POLICY.audMinimumCents,
      currency: "AUD",
      expiresAt,
      pricingModelVersion: HACKATHON_PRICING_POLICY.version,
      repositorySha: input.repository_sha.toLowerCase(),
      repositoryUrl,
      task: input.task,
      terms: eligibility.reason,
    });
    const { data, error } = await supabase
      .from("quotes")
      .insert({
        amount_cents: HACKATHON_PRICING_POLICY.audMinimumCents,
        contract_hash: contractHash,
        currency: "AUD",
        eligibility_decision: eligibility,
        expires_at: expiresAt,
        pricing_model_version: HACKATHON_PRICING_POLICY.version,
        repository_sha: input.repository_sha.toLowerCase(),
        repository_url: repositoryUrl,
        request_id: input.idempotency_key,
        status: "rejected",
        task_spec: input.task,
        terms: eligibility.reason,
        user_id: principal.userId,
      })
      .select(QUOTE_SELECT)
      .single();

    if (error?.code === "23505") {
      const concurrentQuote = await getExistingQuote(
        principal.userId,
        input.idempotency_key,
      );

      if (concurrentQuote) {
        return replayExistingQuote(concurrentQuote, input);
      }
    }

    if (error || !data) {
      throw new ControlPlaneError({
        code: "database_error",
        message: "The rejected quote request could not be recorded.",
        status: 500,
      });
    }

    return projectQuote(data as QuoteRow, false);
  }

  const task = {
    id: input.idempotency_key,
    ...input.task,
  };
  const analysis = analyzeTask(task, FIXTURE_MANIFEST);
  const estimate = await estimateTaskCost({
    analysis,
    manifest: FIXTURE_MANIFEST,
    modelRate: HACKATHON_MODEL_RATE,
    task,
  });
  const quote = deriveQuote({
    analysis,
    estimate,
    repositorySha: input.repository_sha.toLowerCase(),
    repositoryUrl: eligibility.normalizedRepositoryUrl,
    task: input.task,
  });
  const { data, error } = await supabase
    .from("quotes")
    .insert({
      amount_cents: quote.amountCents,
      contract_hash: quote.contractHash,
      currency: quote.currency,
      eligibility_decision: eligibility,
      expires_at: quote.expiresAt,
      pricing_model_version: quote.pricingModelVersion,
      repository_sha: quote.repositorySha,
      repository_url: quote.repositoryUrl,
      request_id: input.idempotency_key,
      status: "pending",
      task_spec: quote.task,
      terms: quote.terms,
      user_id: principal.userId,
    })
    .select(QUOTE_SELECT)
    .single();

  if (error?.code === "23505") {
    const concurrentQuote = await getExistingQuote(
      principal.userId,
      input.idempotency_key,
    );

    if (concurrentQuote) {
      return replayExistingQuote(concurrentQuote, input);
    }
  }

  if (error || !data) {
    throw new ControlPlaneError({
      code: "database_error",
      message: "The quote could not be created.",
      status: 500,
    });
  }

  const quoteRow = data as QuoteRow;
  const { error: underwritingError } = await supabase
    .from("quote_underwriting")
    .insert({
      analysis_json: analysis,
      estimate_json: estimate,
      estimator_id: estimate.estimator.id,
      estimator_version: estimate.estimator.version,
      internal_budget_usd_micros: Math.round(
        quote.internalCostBudgetUsd * 1_000_000,
      ),
      predicted_cost_usd_micros: Math.round(
        quote.predictedCostUsd * 1_000_000,
      ),
      quote_id: quoteRow.id,
      rate_card_version: `${HACKATHON_MODEL_RATE.id}:${HACKATHON_MODEL_RATE.effectiveDate}`,
      risk_multiplier: HACKATHON_PRICING_POLICY.riskMultiplier,
      usd_to_aud_rate: HACKATHON_PRICING_POLICY.usdToAudRate,
      user_id: principal.userId,
    });

  if (underwritingError) {
    await supabase.from("quotes").delete().eq("id", quoteRow.id);

    throw new ControlPlaneError({
      code: "database_error",
      message: "The quote underwriting record could not be created.",
      status: 500,
    });
  }

  return projectQuote(quoteRow, false);
};
