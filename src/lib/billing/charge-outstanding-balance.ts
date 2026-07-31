import "server-only";

import {
  classifyPinchPaymentStatus,
  isDefinitivePinchRejection,
  resolvePaymentOutcomeOrder,
  submitOrRecoverPinchPayment,
} from "@/lib/billing/charge-verified-task";
import { CHARGE_THRESHOLD_CENTS } from "@/lib/billing/threshold";
import type { PinchPayment } from "@/lib/pinch/client";
import { createAdminClient } from "@/lib/supabase/admin";

const MUTABLE_PAYMENT_STATUSES = [
  "reserved",
  "submitting",
  "unknown",
] as const;
const TERMINAL_PAYMENT_STATUSES = [
  "approved",
  "failed",
  "pending",
  "settled",
] as const;
const SUBMISSION_RECOVERY_DELAY_MS = 5 * 60 * 1_000;

type BatchPaymentRow = {
  amount_cents: number;
  currency: string;
  id: string;
  nonce: string;
  provider_payer_id_snapshot: string | null;
  provider_payment_id: string | null;
  provider_source_id_snapshot: string | null;
  status: string;
  updated_at: string;
  user_id: string;
};

type BillingClaimRow = {
  accrual_count: number;
  amount_cents: number;
  currency: string;
  payment_id: string;
};

type SettlementCandidateRow = {
  candidate_user_id: string;
};

export type ChargeOutstandingBalanceResult = {
  accrualCount: number;
  amountCents: number;
  paymentId: string | null;
  paymentStatus: string;
  providerPaymentId: string | null;
  replayed: boolean;
  userId: string;
};

export type SettleOutstandingBalancesResult = {
  failed: number;
  processed: number;
  results: ChargeOutstandingBalanceResult[];
  skipped: number;
};

const requireAdminClient = () => {
  const supabase = createAdminClient();

  if (!supabase) {
    throw new Error("Billing is not configured.");
  }

  return supabase;
};

const getBatchPayment = async (
  paymentId: string,
): Promise<BatchPaymentRow> => {
  const { data, error } = await requireAdminClient()
    .from("payments")
    .select(
      "id, user_id, amount_cents, currency, nonce, status, provider_payment_id, provider_payer_id_snapshot, provider_source_id_snapshot, updated_at",
    )
    .eq("id", paymentId)
    .single();

  if (error || !data) {
    throw new Error("The reserved billing payment is unavailable.", {
      cause: error,
    });
  }

  return data as BatchPaymentRow;
};

const getAllocationCount = async (paymentId: string): Promise<number> => {
  const { count, error } = await requireAdminClient()
    .from("payment_allocations")
    .select("id", { count: "exact", head: true })
    .eq("payment_id", paymentId);

  if (error) {
    throw new Error("The payment allocations are unavailable.", {
      cause: error,
    });
  }

  return count ?? 0;
};

const persistPaymentOutcome = async ({
  failureMessage,
  payment,
  pinchPayment,
  status,
}: {
  failureMessage: string | null;
  payment: BatchPaymentRow;
  pinchPayment: PinchPayment | null;
  status: "approved" | "failed" | "pending" | "unknown";
}): Promise<{
  providerPaymentId: string | null;
  replayed: boolean;
  status: string;
}> => {
  const supabase = requireAdminClient();
  const terminalAt = new Date().toISOString();
  const { data: transitionedPayment, error } = await supabase
    .from("payments")
    .update({
      charged_at:
        status === "approved" || status === "pending" ? terminalAt : null,
      failure_code: pinchPayment?.dishonour?.code ?? null,
      failure_message:
        pinchPayment?.dishonour?.message ?? failureMessage,
      provider_attempt_id: pinchPayment?.attemptId ?? null,
      provider_payment_id: pinchPayment?.id ?? null,
      status,
    })
    .eq("id", payment.id)
    .eq("user_id", payment.user_id)
    .in("status", [...MUTABLE_PAYMENT_STATUSES])
    .select("provider_payment_id, status")
    .maybeSingle();

  if (error) {
    throw new Error("The Pinch batch result could not be persisted.", {
      cause: error,
    });
  }

  if (transitionedPayment) {
    return {
      providerPaymentId: transitionedPayment.provider_payment_id,
      replayed: false,
      status: transitionedPayment.status,
    };
  }

  const { data: currentPayment, error: currentError } = await supabase
    .from("payments")
    .select("provider_payment_id, status")
    .eq("id", payment.id)
    .eq("user_id", payment.user_id)
    .single();

  if (currentError || !currentPayment) {
    throw new Error("The concurrent payment result is unavailable.", {
      cause: currentError,
    });
  }

  const winningStatus = resolvePaymentOutcomeOrder(
    currentPayment.status as Parameters<typeof resolvePaymentOutcomeOrder>[0],
    status,
  );

  return {
    providerPaymentId: currentPayment.provider_payment_id,
    replayed: true,
    status: winningStatus,
  };
};

const submitBatchPayment = async (
  payment: BatchPaymentRow,
  accrualCount: number,
): Promise<ChargeOutstandingBalanceResult> => {
  if (
    !payment.provider_payer_id_snapshot ||
    !payment.provider_source_id_snapshot
  ) {
    throw new Error("The immutable payment provider payload is unavailable.");
  }

  if (
    payment.status === "submitting" &&
    Date.now() - new Date(payment.updated_at).getTime() <
      SUBMISSION_RECOVERY_DELAY_MS
  ) {
    return {
      accrualCount,
      amountCents: payment.amount_cents,
      paymentId: payment.id,
      paymentStatus: "submitting",
      providerPaymentId: payment.provider_payment_id,
      replayed: true,
      userId: payment.user_id,
    };
  }

  if (
    TERMINAL_PAYMENT_STATUSES.includes(
      payment.status as (typeof TERMINAL_PAYMENT_STATUSES)[number],
    )
  ) {
    return {
      accrualCount,
      amountCents: payment.amount_cents,
      paymentId: payment.id,
      paymentStatus: payment.status,
      providerPaymentId: payment.provider_payment_id,
      replayed: true,
      userId: payment.user_id,
    };
  }

  const supabase = requireAdminClient();

  if (payment.status !== "submitting") {
    const { data: submittingPayment, error } = await supabase
      .from("payments")
      .update({ status: "submitting" })
      .eq("id", payment.id)
      .eq("user_id", payment.user_id)
      .in("status", ["reserved", "unknown"])
      .select("id")
      .maybeSingle();

    if (error) {
      throw new Error("The batch payment submission could not be claimed.", {
        cause: error,
      });
    }

    if (!submittingPayment) {
      return submitBatchPayment(
        await getBatchPayment(payment.id),
        accrualCount,
      );
    }
  }

  let pinchPayment: PinchPayment;

  try {
    pinchPayment = await submitOrRecoverPinchPayment({
      existingStatus: payment.status,
      input: {
        amountCents: payment.amount_cents,
        description: `Outcomes: ${accrualCount} verified ${
          accrualCount === 1 ? "task" : "tasks"
        }`,
        metadata: {
          outcomesAccrualCount: String(accrualCount),
          outcomesPaymentId: payment.id,
          outcomesUserId: payment.user_id,
        },
        nonce: payment.nonce,
        payerId: payment.provider_payer_id_snapshot,
        sourceId: payment.provider_source_id_snapshot,
      },
    });
  } catch (error) {
    const definitiveFailure = isDefinitivePinchRejection(error);
    const outcome = await persistPaymentOutcome({
      failureMessage: definitiveFailure
        ? "Pinch rejected the accrued balance charge."
        : "Pinch submission outcome is unknown; retry only with the same nonce.",
      payment,
      pinchPayment: null,
      status: definitiveFailure ? "failed" : "unknown",
    });

    return {
      accrualCount,
      amountCents: payment.amount_cents,
      paymentId: payment.id,
      paymentStatus: outcome.status,
      providerPaymentId: outcome.providerPaymentId,
      replayed: outcome.replayed,
      userId: payment.user_id,
    };
  }

  let paymentStatus = classifyPinchPaymentStatus(pinchPayment);
  const payloadMatches =
    pinchPayment.amount === payment.amount_cents &&
    pinchPayment.currency === payment.currency;

  if (
    ["approved", "pending"].includes(paymentStatus) &&
    !payloadMatches
  ) {
    paymentStatus = "unknown";
  }

  const outcome = await persistPaymentOutcome({
    failureMessage:
      paymentStatus === "unknown"
        ? "Pinch returned an unrecognized or mismatched batch result."
        : null,
    payment,
    pinchPayment,
    status: paymentStatus,
  });

  return {
    accrualCount,
    amountCents: payment.amount_cents,
    paymentId: payment.id,
    paymentStatus: outcome.status,
    providerPaymentId: outcome.providerPaymentId,
    replayed: outcome.replayed,
    userId: payment.user_id,
  };
};

export const chargeOutstandingBalance = async (
  userId: string,
): Promise<ChargeOutstandingBalanceResult> => {
  const supabase = requireAdminClient();
  const { data: recoverablePayment, error: recoveryError } = await supabase
    .from("payments")
    .select(
      "id, user_id, amount_cents, currency, nonce, status, provider_payment_id, provider_payer_id_snapshot, provider_source_id_snapshot, updated_at",
    )
    .eq("user_id", userId)
    .in("status", [...MUTABLE_PAYMENT_STATUSES])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (recoveryError) {
    throw new Error("Recoverable billing payments could not be loaded.", {
      cause: recoveryError,
    });
  }

  if (recoverablePayment) {
    const payment = recoverablePayment as BatchPaymentRow;
    return submitBatchPayment(
      payment,
      await getAllocationCount(payment.id),
    );
  }

  const { data, error } = await supabase.rpc("claim_billing_accruals", {
    p_threshold_cents: CHARGE_THRESHOLD_CENTS,
    p_user_id: userId,
  });
  const claim = (data as BillingClaimRow[] | null)?.[0];

  if (error) {
    throw new Error("The outstanding balance could not be claimed.", {
      cause: error,
    });
  }

  if (!claim) {
    return {
      accrualCount: 0,
      amountCents: 0,
      paymentId: null,
      paymentStatus: "below_threshold",
      providerPaymentId: null,
      replayed: false,
      userId,
    };
  }

  const payment = await getBatchPayment(claim.payment_id);

  if (
    payment.amount_cents !== claim.amount_cents ||
    payment.currency !== claim.currency
  ) {
    throw new Error("The claimed balance does not match its payment.");
  }

  return submitBatchPayment(payment, claim.accrual_count);
};

export const settleOutstandingBalances = async ({
  batchSize = 25,
}: {
  batchSize?: number;
} = {}): Promise<SettleOutstandingBalancesResult> => {
  const supabase = requireAdminClient();
  const safeBatchSize = Math.max(1, Math.min(batchSize, 100));
  const { data, error } = await supabase.rpc(
    "list_billing_settlement_candidates",
    {
      p_batch_size: safeBatchSize,
      p_threshold_cents: CHARGE_THRESHOLD_CENTS,
    },
  );

  if (error) {
    throw new Error("Outstanding billing accounts could not be loaded.", {
      cause: error,
    });
  }

  const candidates = (data as SettlementCandidateRow[] | null) ?? [];
  const results: ChargeOutstandingBalanceResult[] = [];
  let failed = 0;

  for (const { candidate_user_id: userId } of candidates) {
    try {
      results.push(await chargeOutstandingBalance(userId));
    } catch {
      failed += 1;
    }
  }

  return {
    failed,
    processed: results.length,
    results,
    skipped: results.filter(
      ({ paymentStatus }) => paymentStatus === "below_threshold",
    ).length,
  };
};
