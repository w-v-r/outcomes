import "server-only";

import {
  checkPinchPaymentNonce,
  createPinchRealtimePayment,
  type CreateRealtimePaymentInput,
  PinchApiError,
  type PinchPayment,
} from "@/lib/pinch/client";
import { createAdminClient } from "@/lib/supabase/admin";

export type ChargeVerifiedTaskResult = {
  paymentId: string | null;
  paymentStatus: string;
  replayed: boolean;
};

const MUTABLE_PAYMENT_STATUSES = [
  "reserved",
  "submitting",
  "unknown",
] as const;
type PersistedPaymentStatus =
  | "approved"
  | "failed"
  | "pending"
  | "reserved"
  | "submitting"
  | "unknown";

export const resolvePaymentOutcomeOrder = (
  current: PersistedPaymentStatus,
  incoming: PersistedPaymentStatus,
): PersistedPaymentStatus =>
  ["approved", "failed", "pending"].includes(current)
    ? current
    : incoming;

export const classifyPinchPaymentStatus = (
  payment: PinchPayment,
): "approved" | "failed" | "pending" | "unknown" => {
  const normalizedStatus = payment.status.toLowerCase();

  if (normalizedStatus === "approved" || normalizedStatus === "pending") {
    return normalizedStatus;
  }

  if (
    payment.dishonour ||
    ["declined", "dishonoured", "failed", "rejected"].includes(
      normalizedStatus,
    )
  ) {
    return "failed";
  }

  return "unknown";
};

export const isDefinitivePinchRejection = (error: unknown): boolean =>
  error instanceof PinchApiError && [400, 422].includes(error.status);

export const submitOrRecoverPinchPayment = async ({
  createPayment = createPinchRealtimePayment,
  existingStatus,
  input,
  lookupNonce = checkPinchPaymentNonce,
}: {
  createPayment?: (
    input: CreateRealtimePaymentInput,
  ) => Promise<PinchPayment>;
  existingStatus: string | null;
  input: CreateRealtimePaymentInput;
  lookupNonce?: typeof checkPinchPaymentNonce;
}): Promise<PinchPayment> => {
  if (
    existingStatus &&
    ["reserved", "submitting", "unknown", "approved", "pending"].includes(
      existingStatus,
    )
  ) {
    const nonceResult = await lookupNonce(input.nonce);

    if (nonceResult.isNonceReplay && nonceResult.data) {
      return nonceResult.data;
    }
  }

  try {
    return await createPayment(input);
  } catch (error) {
    try {
      const nonceResult = await lookupNonce(input.nonce);

      if (nonceResult.isNonceReplay && nonceResult.data) {
        return nonceResult.data;
      }
    } catch {
      // The original create error is more useful and preserves ambiguity.
    }

    throw error;
  }
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
    { data: existingPayment, error: existingPaymentError },
  ] = await Promise.all([
    supabase
      .from("quotes")
      .select("id, amount_cents, currency, status")
      .eq("task_id", task.id)
      .eq("user_id", task.user_id)
      .single(),
    supabase
      .from("payments")
      .select(
        "id, quote_id, amount_cents, currency, billing_account_id, payment_source_id, provider_payer_id_snapshot, provider_source_id_snapshot, nonce, status, provider_payment_id",
      )
      .eq("task_id", task.id)
      .eq("user_id", task.user_id)
      .maybeSingle(),
  ]);

  if (
    quoteError ||
    quote?.status !== "approved" ||
    existingPaymentError
  ) {
    throw new Error(
      "The approved quote or sandbox billing account is unavailable.",
    );
  }

  if (
    existingPayment &&
    (existingPayment.quote_id !== quote.id ||
      existingPayment.amount_cents !== quote.amount_cents ||
      existingPayment.currency !== quote.currency)
  ) {
    throw new Error("The reserved payment does not match the approved quote.");
  }

  const settleTaskForTerminalPayment = async ({
    paymentId,
    paymentStatus,
    replayed,
  }: {
    paymentId: string | null;
    paymentStatus: "approved" | "failed" | "pending";
    replayed: boolean;
  }): Promise<ChargeVerifiedTaskResult> => {
    const completedAt = new Date().toISOString();
    const isFailed = paymentStatus === "failed";
    const { error } = await supabase
      .from("tasks")
      .update({
        completed_at: isFailed ? null : completedAt,
        failed_at: isFailed ? completedAt : null,
        failure_reason: isFailed
          ? "Pinch rejected the sandbox charge."
          : null,
        status: isFailed ? "payment_failed" : "completed",
      })
      .eq("id", task.id)
      .eq("user_id", task.user_id)
      .in("status", ["verified", "charging"]);

    if (error) {
      throw new Error("The terminal task payment state could not be persisted.", {
        cause: error,
      });
    }

    return {
      paymentId,
      paymentStatus,
      replayed,
    };
  };

  if (
    existingPayment &&
    ["approved", "pending", "failed"].includes(existingPayment.status)
  ) {
    return settleTaskForTerminalPayment({
      paymentId: existingPayment.provider_payment_id as string | null,
      paymentStatus: existingPayment.status as
        | "approved"
        | "failed"
        | "pending",
      replayed: true,
    });
  }

  const nonce =
    existingPayment?.nonce ?? `outcomes-task-${task.id}-charge-v1`;
  let paymentRecord = existingPayment;

  if (!paymentRecord) {
    const { data: billingAccount, error: billingError } = await supabase
      .from("billing_accounts")
      .select("id, provider_payer_id")
      .eq("status", "ready")
      .eq("user_id", task.user_id)
      .single();

    if (billingError || !billingAccount?.provider_payer_id) {
      throw new Error("The sandbox billing account is unavailable.");
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
        provider_payer_id_snapshot: billingAccount.provider_payer_id,
        provider_source_id_snapshot: paymentSource.provider_source_id,
        quote_id: quote.id,
        status: "reserved",
        task_id: task.id,
        user_id: task.user_id,
      })
      .select(
        "id, quote_id, amount_cents, currency, billing_account_id, payment_source_id, provider_payer_id_snapshot, provider_source_id_snapshot, nonce, status, provider_payment_id",
      )
      .single();

    paymentRecord = reservedPayment;

    if (reserveError || !paymentRecord) {
      const { data: concurrentPayment, error: concurrentPaymentError } =
        await supabase
          .from("payments")
          .select(
            "id, quote_id, amount_cents, currency, billing_account_id, payment_source_id, provider_payer_id_snapshot, provider_source_id_snapshot, nonce, status, provider_payment_id",
          )
          .eq("task_id", task.id)
          .eq("user_id", task.user_id)
          .maybeSingle();

      if (concurrentPaymentError) {
        throw new Error("The concurrent payment could not be loaded.", {
          cause: concurrentPaymentError,
        });
      }

      if (concurrentPayment) {
        paymentRecord = concurrentPayment;
      } else {
        throw new Error("The payment could not be reserved.");
      }
    }
  }

  if (!paymentRecord) {
    throw new Error("The payment could not be reserved.");
  }

  if (
    paymentRecord.quote_id !== quote.id ||
    paymentRecord.amount_cents !== quote.amount_cents ||
    paymentRecord.currency !== quote.currency
  ) {
    throw new Error("The reserved payment does not match the approved quote.");
  }

  if (
    !paymentRecord.provider_payer_id_snapshot ||
    !paymentRecord.provider_source_id_snapshot
  ) {
    throw new Error(
      "The immutable payment provider payload is unavailable.",
    );
  }

  const { data: submittingPayment, error: submittingError } = await supabase
    .from("payments")
    .update({ status: "submitting" })
    .eq("id", paymentRecord.id)
    .eq("user_id", task.user_id)
    .in("status", [...MUTABLE_PAYMENT_STATUSES])
    .select("id")
    .maybeSingle();

  if (submittingError) {
    throw new Error("The payment submission could not be claimed.", {
      cause: submittingError,
    });
  }

  if (!submittingPayment) {
    const { data: concurrentTerminal, error: concurrentTerminalError } =
      await supabase
        .from("payments")
        .select("status, provider_payment_id")
        .eq("id", paymentRecord.id)
        .eq("user_id", task.user_id)
        .single();

    if (
      concurrentTerminalError ||
      !concurrentTerminal ||
      !["approved", "pending", "failed"].includes(
        concurrentTerminal.status,
      )
    ) {
      throw new Error("The payment submission state changed concurrently.", {
        cause: concurrentTerminalError,
      });
    }

    return settleTaskForTerminalPayment({
      paymentId: concurrentTerminal.provider_payment_id,
      paymentStatus: concurrentTerminal.status as
        | "approved"
        | "failed"
        | "pending",
      replayed: true,
    });
  }

  const { error: chargingError } = await supabase
    .from("tasks")
    .update({ status: "charging" })
    .eq("id", task.id)
    .eq("user_id", task.user_id)
    .in("status", ["verified", "charging"]);

  if (chargingError) {
    throw new Error("The verified task could not enter charging.", {
      cause: chargingError,
    });
  }

  const persistPaymentOutcome = async ({
    failureMessage,
    pinchPayment,
    status,
  }: {
    failureMessage: string | null;
    pinchPayment: PinchPayment | null;
    status: "approved" | "failed" | "pending" | "unknown";
  }): Promise<ChargeVerifiedTaskResult> => {
    const terminalAt = new Date().toISOString();
    const { data: transitionedPayment, error: paymentUpdateError } =
      await supabase
      .from("payments")
      .update({
        charged_at:
          status === "approved" || status === "pending"
            ? terminalAt
            : null,
        failure_code: pinchPayment?.dishonour?.code ?? null,
        failure_message:
          pinchPayment?.dishonour?.message ?? failureMessage,
        provider_attempt_id: pinchPayment?.attemptId ?? null,
        provider_payment_id: pinchPayment?.id ?? null,
        status,
      })
      .eq("id", paymentRecord.id)
      .eq("user_id", task.user_id)
      .in("status", [...MUTABLE_PAYMENT_STATUSES])
      .select("status, provider_payment_id")
      .maybeSingle();

    if (paymentUpdateError) {
      throw new Error("The Pinch result could not be persisted.", {
        cause: paymentUpdateError,
      });
    }

    if (!transitionedPayment) {
      const { data: currentPayment, error: currentPaymentError } =
        await supabase
          .from("payments")
          .select("status, provider_payment_id")
          .eq("id", paymentRecord.id)
          .eq("user_id", task.user_id)
          .single();

      if (currentPaymentError || !currentPayment) {
        throw new Error("The concurrent payment result is unavailable.", {
          cause: currentPaymentError,
        });
      }

      const winningStatus = resolvePaymentOutcomeOrder(
        currentPayment.status as PersistedPaymentStatus,
        status,
      );

      if (["approved", "pending", "failed"].includes(winningStatus)) {
        return settleTaskForTerminalPayment({
          paymentId: currentPayment.provider_payment_id,
          paymentStatus: winningStatus as
            | "approved"
            | "failed"
            | "pending",
          replayed: true,
        });
      }

      throw new Error("The payment state changed concurrently.");
    }

    if (status !== "unknown") {
      return settleTaskForTerminalPayment({
        paymentId: pinchPayment?.id ?? null,
        paymentStatus: status,
        replayed: false,
      });
    }

    const { error: taskUpdateError } = await supabase
      .from("tasks")
      .update({
        failed_at: null,
        failure_reason: null,
        status: "charging",
      })
      .eq("id", task.id)
      .eq("user_id", task.user_id)
      .in("status", ["verified", "charging"]);

    if (taskUpdateError) {
      throw new Error("The ambiguous task payment state could not be persisted.", {
        cause: taskUpdateError,
      });
    }

    return { paymentId: null, paymentStatus: "unknown", replayed: false };
  };

  let pinchPayment: PinchPayment;

  try {
    pinchPayment = await submitOrRecoverPinchPayment({
      existingStatus: paymentRecord.status,
      input: {
        amountCents: paymentRecord.amount_cents,
        description: `Outcomes: ${task.title}`,
        metadata: {
          outcomesQuoteId: quote.id,
          outcomesTaskId: task.id,
          outcomesUserId: task.user_id,
        },
        nonce,
        payerId: paymentRecord.provider_payer_id_snapshot,
        sourceId: paymentRecord.provider_source_id_snapshot,
      },
    });
  } catch (error) {
    const isDefinitiveFailure = isDefinitivePinchRejection(error);

    const failureReason = isDefinitiveFailure
      ? "Pinch rejected the sandbox charge."
      : "Pinch submission outcome is unknown; do not retry with a new nonce.";
    return persistPaymentOutcome({
      failureMessage: failureReason,
      pinchPayment: null,
      status: isDefinitiveFailure ? "failed" : "unknown",
    });
  }

  let paymentStatus = classifyPinchPaymentStatus(pinchPayment);
  const providerPayloadMatchesReservation =
    pinchPayment.amount === paymentRecord.amount_cents &&
    pinchPayment.currency === paymentRecord.currency;

  if (
    (paymentStatus === "approved" || paymentStatus === "pending") &&
    !providerPayloadMatchesReservation
  ) {
    paymentStatus = "unknown";
  }

  return persistPaymentOutcome({
    failureMessage:
      paymentStatus === "unknown"
        ? "Pinch returned an unrecognized or mismatched payment result; reconciliation is required."
        : null,
    pinchPayment,
    status: paymentStatus,
  });
};
