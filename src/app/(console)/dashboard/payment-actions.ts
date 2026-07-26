"use server";

import { revalidatePath } from "next/cache";

import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";
import { hasCompletedBillingSetup } from "@/lib/billing/get-billing-account";
import {
  checkPinchPaymentNonce,
  createPinchRealtimePayment,
  PinchApiError,
  type PinchPayment,
} from "@/lib/pinch/client";
import { createClient } from "@/lib/supabase/server";

export type DemoActionState = {
  message: string | null;
  status: "error" | "success" | null;
};

const DEMO_AMOUNT_CENTS = 1250;
const DEMO_TERMS =
  "Charge the approved fixed price only after the acceptance criteria are verified.";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getOwnedId = (formData: FormData, field: string) => {
  const value = String(formData.get(field) ?? "");

  return UUID_PATTERN.test(value) ? value : null;
};

const getAuthenticatedContext = async () => {
  const user = await getAuthenticatedUser();

  if (!user) {
    return null;
  }

  const billingReady = await hasCompletedBillingSetup(user.id);

  if (!billingReady) {
    return null;
  }

  return {
    supabase: await createClient(),
    user,
  };
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
    .in("status", ["quoted", "approved", "executing", "verified"])
    .limit(1)
    .maybeSingle();

  if (activeTask) {
    return {
      message: "Finish the current sandbox task before creating another.",
      status: "error",
    };
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      acceptance_criteria:
        "Produce the requested customer-ready outcome and record successful verification.",
      description:
        "A simulated agent task used to prove quote approval, verified completion, and Pinch charging.",
      status: "quoted",
      title: "Prepare sandbox outcome report",
      user_id: user.id,
    })
    .select("id")
    .single();

  if (taskError) {
    return {
      message: "The sandbox task could not be created.",
      status: "error",
    };
  }

  const { error: quoteError } = await supabase.from("quotes").insert({
    amount_cents: DEMO_AMOUNT_CENTS,
    currency: "AUD",
    pricing_model_version: "hackathon-demo-v1",
    status: "pending",
    task_id: task.id,
    terms: DEMO_TERMS,
    user_id: user.id,
  });

  if (quoteError) {
    return {
      message: "The fixed-price quote could not be created.",
      status: "error",
    };
  }

  revalidatePath("/dashboard");

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
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .update({
      approved_at: approvedAt,
      status: "approved",
    })
    .eq("id", quoteId)
    .eq("status", "pending")
    .eq("user_id", user.id)
    .select("task_id")
    .single();

  if (quoteError) {
    return {
      message: "Only a pending quote can be approved.",
      status: "error",
    };
  }

  const { error: taskError } = await supabase
    .from("tasks")
    .update({ status: "approved" })
    .eq("id", quote.task_id)
    .eq("status", "quoted")
    .eq("user_id", user.id);

  if (taskError) {
    return {
      message: "The task could not be moved into its approved state.",
      status: "error",
    };
  }

  revalidatePath("/dashboard");

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
    .select("id, title, status")
    .eq("id", taskId)
    .eq("user_id", user.id)
    .single();

  if (taskError || !["approved", "verified"].includes(task.status)) {
    return {
      message: "Approve the quote before simulating completion.",
      status: "error",
    };
  }

  const [
    { data: quote, error: quoteError },
    { data: billingAccount, error: billingError },
    { data: existingPayment },
  ] = await Promise.all([
    supabase
      .from("quotes")
      .select("id, amount_cents, currency, status")
      .eq("task_id", task.id)
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("billing_accounts")
      .select("id, provider_payer_id")
      .eq("status", "ready")
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("payments")
      .select("id, status, provider_payment_id")
      .eq("task_id", task.id)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (
    quoteError ||
    quote.status !== "approved" ||
    billingError ||
    !billingAccount.provider_payer_id
  ) {
    return {
      message: "The approved quote or sandbox billing account is unavailable.",
      status: "error",
    };
  }

  if (existingPayment) {
    return {
      message: existingPayment.provider_payment_id
        ? `This task already has Pinch payment ${existingPayment.provider_payment_id}.`
        : `This task already has a ${existingPayment.status} payment attempt.`,
      status: "success",
    };
  }

  const { data: paymentSource, error: sourceError } = await supabase
    .from("payment_sources")
    .select("id, provider_source_id")
    .eq("billing_account_id", billingAccount.id)
    .eq("is_default", true)
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (sourceError) {
    return {
      message: "No default Pinch sandbox source is available.",
      status: "error",
    };
  }

  const nonce = `outcomes-task-${task.id}-charge-v1`;
  const { data: reservedPayment, error: reserveError } = await supabase
    .from("payments")
    .insert({
      amount_cents: quote.amount_cents,
      billing_account_id: billingAccount.id,
      currency: quote.currency,
      environment: "test",
      nonce,
      payment_source_id: paymentSource.id,
      provider: "pinch",
      quote_id: quote.id,
      status: "reserved",
      task_id: task.id,
      user_id: user.id,
    })
    .select("id")
    .single();

  if (reserveError) {
    const { data: concurrentPayment } = await supabase
      .from("payments")
      .select("provider_payment_id, status")
      .eq("task_id", task.id)
      .eq("user_id", user.id)
      .maybeSingle();

    return {
      message: concurrentPayment?.provider_payment_id
        ? `This task already has Pinch payment ${concurrentPayment.provider_payment_id}.`
        : "A payment is already reserved for this task. No duplicate charge was sent.",
      status: "success",
    };
  }

  const verifiedAt = new Date().toISOString();
  await Promise.all([
    supabase
      .from("tasks")
      .update({ status: "verified", verified_at: verifiedAt })
      .eq("id", task.id)
      .eq("user_id", user.id),
    supabase
      .from("payments")
      .update({ status: "submitting" })
      .eq("id", reservedPayment.id)
      .eq("user_id", user.id),
  ]);

  const persistPinchResult = async (pinchPayment: PinchPayment) => {
    const normalizedStatus = pinchPayment.status.toLowerCase();
    const paymentStatus = ["approved", "pending"].includes(normalizedStatus)
      ? normalizedStatus
      : "failed";
    const completedAt = new Date().toISOString();

    await Promise.all([
      supabase
        .from("payments")
        .update({
          charged_at: completedAt,
          failure_code: pinchPayment.dishonour?.code ?? null,
          failure_message: pinchPayment.dishonour?.message ?? null,
          provider_attempt_id: pinchPayment.attemptId,
          provider_payment_id: pinchPayment.id,
          status: paymentStatus,
        })
        .eq("id", reservedPayment.id)
        .eq("user_id", user.id),
      supabase
        .from("tasks")
        .update({ completed_at: completedAt, status: "completed" })
        .eq("id", task.id)
        .eq("user_id", user.id),
    ]);

    return paymentStatus;
  };

  try {
    const pinchPayment = await createPinchRealtimePayment({
      amountCents: quote.amount_cents,
      description: `Outcomes: ${task.title}`,
      metadata: {
        outcomesQuoteId: quote.id,
        outcomesTaskId: task.id,
        outcomesUserId: user.id,
      },
      nonce,
      payerId: billingAccount.provider_payer_id,
      sourceId: paymentSource.provider_source_id,
    });
    const paymentStatus = await persistPinchResult(pinchPayment);

    revalidatePath("/dashboard");

    return {
      message: `Pinch sandbox payment ${pinchPayment.id} returned ${pinchPayment.status}.`,
      status: paymentStatus === "failed" ? "error" : "success",
    };
  } catch (error) {
    const isDefinitiveFailure =
      error instanceof PinchApiError && error.status < 500;

    if (!isDefinitiveFailure) {
      try {
        const nonceResult = await checkPinchPaymentNonce(nonce);

        if (nonceResult.isNonceReplay && nonceResult.data) {
          const paymentStatus = await persistPinchResult(nonceResult.data);

          revalidatePath("/dashboard");

          return {
            message: `Pinch confirmed payment ${nonceResult.data.id} after the interrupted response.`,
            status: paymentStatus === "failed" ? "error" : "success",
          };
        }
      } catch {
        // Preserve an unknown state if Pinch cannot confirm the nonce.
      }
    }

    await supabase
      .from("payments")
      .update({
        failure_message: isDefinitiveFailure
          ? "Pinch rejected the sandbox charge."
          : "Pinch submission outcome is unknown; do not retry with a new nonce.",
        status: isDefinitiveFailure ? "failed" : "unknown",
      })
      .eq("id", reservedPayment.id)
      .eq("user_id", user.id);

    revalidatePath("/dashboard");

    return {
      message: isDefinitiveFailure
        ? "Pinch rejected the sandbox charge. No real funds were involved."
        : "The Pinch response was interrupted. The payment is marked unknown to prevent a duplicate charge.",
      status: "error",
    };
  }
};
