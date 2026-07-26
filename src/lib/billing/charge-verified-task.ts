import "server-only";

import {
  checkPinchPaymentNonce,
  createPinchRealtimePayment,
  PinchApiError,
  type PinchPayment,
} from "@/lib/pinch/client";
import { createAdminClient } from "@/lib/supabase/admin";

export type ChargeVerifiedTaskResult = {
  paymentId: string | null;
  paymentStatus: string;
  replayed: boolean;
};

const requireAdminClient = () => {
  const supabase = createAdminClient();

  if (!supabase) {
    throw new Error("Billing is not configured.");
  }

  return supabase;
};

export const chargeVerifiedTask = async (
  taskId: string,
): Promise<ChargeVerifiedTaskResult> => {
  const supabase = requireAdminClient();
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, user_id, title, status")
    .eq("id", taskId)
    .single();

  if (
    taskError ||
    !task ||
    !["verified", "charging", "completed"].includes(task.status)
  ) {
    throw new Error("Only a verified task can be charged.");
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
      .eq("user_id", task.user_id)
      .single(),
    supabase
      .from("billing_accounts")
      .select("id, provider_payer_id")
      .eq("status", "ready")
      .eq("user_id", task.user_id)
      .single(),
    supabase
      .from("payments")
      .select("id, status, provider_payment_id")
      .eq("task_id", task.id)
      .eq("user_id", task.user_id)
      .maybeSingle(),
  ]);

  if (
    quoteError ||
    quote?.status !== "approved" ||
    billingError ||
    !billingAccount?.provider_payer_id
  ) {
    throw new Error(
      "The approved quote or sandbox billing account is unavailable.",
    );
  }

  if (existingPayment) {
    return {
      paymentId: existingPayment.provider_payment_id as string | null,
      paymentStatus: existingPayment.status as string,
      replayed: true,
    };
  }

  const { data: paymentSource, error: sourceError } = await supabase
    .from("payment_sources")
    .select("id, provider_source_id")
    .eq("billing_account_id", billingAccount.id)
    .eq("is_default", true)
    .eq("user_id", task.user_id)
    .limit(1)
    .single();

  if (sourceError || !paymentSource) {
    throw new Error("No default Pinch sandbox source is available.");
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
      user_id: task.user_id,
    })
    .select("id")
    .single();

  if (reserveError || !reservedPayment) {
    const { data: concurrentPayment } = await supabase
      .from("payments")
      .select("status, provider_payment_id")
      .eq("task_id", task.id)
      .eq("user_id", task.user_id)
      .maybeSingle();

    if (concurrentPayment) {
      return {
        paymentId: concurrentPayment.provider_payment_id as string | null,
        paymentStatus: concurrentPayment.status as string,
        replayed: true,
      };
    }

    throw new Error("The payment could not be reserved.");
  }

  await Promise.all([
    supabase
      .from("tasks")
      .update({ status: "charging" })
      .eq("id", task.id)
      .eq("user_id", task.user_id)
      .in("status", ["verified", "charging"]),
    supabase
      .from("payments")
      .update({ status: "submitting" })
      .eq("id", reservedPayment.id)
      .eq("user_id", task.user_id),
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
        .eq("user_id", task.user_id),
      supabase
        .from("tasks")
        .update({
          completed_at: paymentStatus === "failed" ? null : completedAt,
          failed_at: paymentStatus === "failed" ? completedAt : null,
          failure_reason:
            paymentStatus === "failed"
              ? "Pinch rejected the sandbox charge."
              : null,
          status:
            paymentStatus === "failed" ? "payment_failed" : "completed",
        })
        .eq("id", task.id)
        .eq("user_id", task.user_id),
    ]);

    return {
      paymentId: pinchPayment.id,
      paymentStatus,
      replayed: false,
    };
  };

  try {
    const pinchPayment = await createPinchRealtimePayment({
      amountCents: quote.amount_cents,
      description: `Outcomes: ${task.title}`,
      metadata: {
        outcomesQuoteId: quote.id,
        outcomesTaskId: task.id,
        outcomesUserId: task.user_id,
      },
      nonce,
      payerId: billingAccount.provider_payer_id,
      sourceId: paymentSource.provider_source_id,
    });

    return persistPinchResult(pinchPayment);
  } catch (error) {
    const isDefinitiveFailure =
      error instanceof PinchApiError && error.status < 500;

    if (!isDefinitiveFailure) {
      try {
        const nonceResult = await checkPinchPaymentNonce(nonce);

        if (nonceResult.isNonceReplay && nonceResult.data) {
          return persistPinchResult(nonceResult.data);
        }
      } catch {
        // Preserve an unknown state; a new nonce must never be used.
      }
    }

    const failureReason = isDefinitiveFailure
      ? "Pinch rejected the sandbox charge."
      : "Pinch submission outcome is unknown; do not retry with a new nonce.";
    const failedAt = new Date().toISOString();

    await Promise.all([
      supabase
        .from("payments")
        .update({
          failure_message: failureReason,
          status: isDefinitiveFailure ? "failed" : "unknown",
        })
        .eq("id", reservedPayment.id)
        .eq("user_id", task.user_id),
      supabase
        .from("tasks")
        .update({
          failed_at: failedAt,
          failure_reason: failureReason,
          status: "payment_failed",
        })
        .eq("id", task.id)
        .eq("user_id", task.user_id),
    ]);

    return {
      paymentId: null,
      paymentStatus: isDefinitiveFailure ? "failed" : "unknown",
      replayed: false,
    };
  }
};
