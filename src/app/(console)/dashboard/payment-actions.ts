"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";
import { chargeVerifiedTask } from "@/lib/billing/charge-verified-task";
import { hasCompletedBillingSetup } from "@/lib/billing/get-billing-account";
import { decideTaskEligibility } from "@/lib/pricing/eligibility";
import { estimateTaskCost } from "@/lib/pricing/estimator";
import { deriveQuote } from "@/lib/pricing/quote-policy";
import { HACKATHON_MODEL_RATE } from "@/lib/pricing/rate-card";
import {
  FIXTURE_MANIFEST,
  FIXTURE_REPOSITORY,
  ZERO_DIVISION_TASK_CONTRACT,
} from "@/lib/pricing/registry";
import { analyzeTask } from "@/lib/pricing/task-analysis";
import { createAdminClient } from "@/lib/supabase/admin";

export type DemoActionState = {
  message: string | null;
  status: "error" | "success" | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const getOwnedId = (formData: FormData, field: string) => {
  const value = String(formData.get(field) ?? "");
  return UUID_PATTERN.test(value) ? value : null;
};

const getAuthenticatedContext = async () => {
  const user = await getAuthenticatedUser();

  if (!user || !(await hasCompletedBillingSetup(user.id))) {
    return null;
  }

  const supabase = createAdminClient();
  return supabase ? { supabase, user } : null;
};

export const createSandboxDemoQuote = async (
  _previousState: DemoActionState,
  _formData: FormData,
): Promise<DemoActionState> => {
  void _previousState;
  void _formData;
  const context = await getAuthenticatedContext();

  if (!context) {
    return {
      message: "Complete sandbox billing setup before creating a quote.",
      status: "error",
    };
  }

  const { supabase, user } = context;
  const { data: activeTask } = await supabase
    .from("tasks")
    .select("id")
    .eq("user_id", user.id)
    .like("external_ref", "dashboard-demo-%")
    .in("status", [
      "quoted",
      "approved",
      "starting",
      "executing",
      "worker_succeeded",
      "verifying",
      "verified",
      "charging",
    ])
    .limit(1)
    .maybeSingle();

  if (activeTask) {
    return {
      message: "Finish the current sandbox task before creating another.",
      status: "error",
    };
  }

  const requestId = `dashboard-demo-${randomUUID()}`;
  const taskRequest = {
    id: requestId,
    ...ZERO_DIVISION_TASK_CONTRACT,
  };
  const analysis = analyzeTask(taskRequest, FIXTURE_MANIFEST);
  const estimate = await estimateTaskCost({
    analysis,
    manifest: FIXTURE_MANIFEST,
    modelRate: HACKATHON_MODEL_RATE,
    task: taskRequest,
  });
  const quoteContract = deriveQuote({
    analysis,
    estimate,
    repositorySha: FIXTURE_REPOSITORY.baselineSha,
    repositoryUrl: FIXTURE_REPOSITORY.url,
    task: ZERO_DIVISION_TASK_CONTRACT,
  });
  const eligibility = decideTaskEligibility({
    repositorySha: FIXTURE_REPOSITORY.baselineSha,
    repositoryUrl: FIXTURE_REPOSITORY.url,
    task: ZERO_DIVISION_TASK_CONTRACT,
  });
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      acceptance_criteria:
        ZERO_DIVISION_TASK_CONTRACT.acceptanceCriteria.join("\n"),
      description: ZERO_DIVISION_TASK_CONTRACT.description,
      external_ref: requestId,
      repository_sha: FIXTURE_REPOSITORY.baselineSha,
      repository_url: FIXTURE_REPOSITORY.url,
      status: "quoted",
      task_spec: ZERO_DIVISION_TASK_CONTRACT,
      title: "Fix calculator zero-division behavior",
      user_id: user.id,
    })
    .select("id")
    .single();

  if (taskError || !task) {
    return {
      message: "The sandbox task could not be created.",
      status: "error",
    };
  }

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .insert({
      amount_cents: quoteContract.amountCents,
      contract_hash: quoteContract.contractHash,
      currency: quoteContract.currency,
      eligibility_decision: eligibility,
      expires_at: quoteContract.expiresAt,
      pricing_model_version: quoteContract.pricingModelVersion,
      repository_sha: quoteContract.repositorySha,
      repository_url: quoteContract.repositoryUrl,
      request_id: requestId,
      status: "pending",
      task_id: task.id,
      task_spec: quoteContract.task,
      terms: quoteContract.terms,
      user_id: user.id,
    })
    .select("id")
    .single();

  if (quoteError || !quote) {
    await supabase.from("tasks").delete().eq("id", task.id);

    return {
      message: "The fixed-price quote could not be created.",
      status: "error",
    };
  }

  const [{ error: taskLinkError }, { error: underwritingError }] =
    await Promise.all([
      supabase
        .from("tasks")
        .update({ quote_id: quote.id })
        .eq("id", task.id)
        .eq("user_id", user.id),
      supabase.from("quote_underwriting").insert({
        analysis_json: analysis,
        estimate_json: estimate,
        estimator_id: estimate.estimator.id,
        estimator_version: estimate.estimator.version,
        internal_budget_usd_micros: Math.round(
          quoteContract.internalCostBudgetUsd * 1_000_000,
        ),
        predicted_cost_usd_micros: Math.round(
          quoteContract.predictedCostUsd * 1_000_000,
        ),
        quote_id: quote.id,
        rate_card_version: `${HACKATHON_MODEL_RATE.id}:${HACKATHON_MODEL_RATE.effectiveDate}`,
        risk_multiplier: 3,
        usd_to_aud_rate: 1.55,
        user_id: user.id,
      }),
    ]);

  if (taskLinkError || underwritingError) {
    return {
      message: "The quote metadata could not be completed.",
      status: "error",
    };
  }

  revalidatePath("/console/dashboard");
  revalidatePath("/console/billing");

  return {
    message: "Sandbox quote created. Review and approve the exact amount.",
    status: "success",
  };
};

export const approveSandboxDemoQuote = async (
  _previousState: DemoActionState,
  formData: FormData,
): Promise<DemoActionState> => {
  const quoteId = getOwnedId(formData, "quoteId");
  const context = await getAuthenticatedContext();

  if (!quoteId || !context) {
    return {
      message: "The quote could not be approved.",
      status: "error",
    };
  }

  const { supabase, user } = context;
  const approvedAt = new Date().toISOString();
  const acceptanceIdempotencyKey = `dashboard-accept-${quoteId}`;
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .update({
      acceptance_idempotency_key: acceptanceIdempotencyKey,
      accepted_at: approvedAt,
      approved_at: approvedAt,
      status: "approved",
    })
    .eq("id", quoteId)
    .like("request_id", "dashboard-demo-%")
    .eq("status", "pending")
    .eq("user_id", user.id)
    .select("task_id")
    .single();

  if (quoteError || !quote?.task_id) {
    return {
      message: "Only a pending quote can be approved.",
      status: "error",
    };
  }

  const { error: taskError } = await supabase
    .from("tasks")
    .update({
      idempotency_key: acceptanceIdempotencyKey,
      status: "approved",
      worker_provider: "cursor",
      worker_runtime: "cloud",
    })
    .eq("id", quote.task_id)
    .eq("status", "quoted")
    .eq("user_id", user.id);

  if (taskError) {
    return {
      message: "The task could not be moved into its approved state.",
      status: "error",
    };
  }

  revalidatePath("/console/dashboard");
  revalidatePath("/console/billing");

  return {
    message: "Quote approved. The simulated worker can now complete the task.",
    status: "success",
  };
};

export const completeAndChargeSandboxTask = async (
  _previousState: DemoActionState,
  formData: FormData,
): Promise<DemoActionState> => {
  const taskId = getOwnedId(formData, "taskId");
  const context = await getAuthenticatedContext();

  if (!taskId || !context) {
    return {
      message: "The sandbox task could not be completed.",
      status: "error",
    };
  }

  const { supabase, user } = context;
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("external_ref, id, status")
    .eq("id", taskId)
    .eq("user_id", user.id)
    .single();

  if (
    taskError ||
    !task ||
    !task.external_ref?.startsWith("dashboard-demo-") ||
    !["approved", "verified", "charging", "completed"].includes(task.status)
  ) {
    return {
      message: "Approve the quote before simulating completion.",
      status: "error",
    };
  }

  if (task.status === "approved") {
    const verifiedAt = new Date().toISOString();
    const { error: verificationError } = await supabase
      .from("tasks")
      .update({ status: "verified", verified_at: verifiedAt })
      .eq("id", task.id)
      .eq("user_id", user.id)
      .eq("status", "approved");

    if (verificationError) {
      return {
        message: "The simulated verification could not be recorded.",
        status: "error",
      };
    }
  }

  try {
    const payment = await chargeVerifiedTask(task.id);

    revalidatePath("/console/dashboard");
    revalidatePath("/console/billing");

    return {
      message: payment.paymentId
        ? `Pinch sandbox payment ${payment.paymentId} is ${payment.paymentStatus}.`
        : `Pinch sandbox payment is ${payment.paymentStatus}.`,
      status:
        ["failed", "unknown"].includes(payment.paymentStatus)
          ? "error"
          : "success",
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "The sandbox payment could not be submitted.",
      status: "error",
    };
  }
};
