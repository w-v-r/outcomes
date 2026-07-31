import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type AccrueVerifiedTaskResult = {
  accrualId: string;
  amountCents: number;
  currency: string;
  paymentId: string | null;
  replayed: boolean;
  status: string;
  userId: string;
};

type AccrualClaimRow = {
  accrual_id: string;
  amount_cents: number;
  currency: string;
  payment_id: string | null;
  replayed: boolean;
  status: string;
  user_id: string;
};

export const accrueVerifiedTask = async (
  taskId: string,
): Promise<AccrueVerifiedTaskResult> => {
  const supabase = createAdminClient();

  if (!supabase) {
    throw new Error("Billing is not configured.");
  }

  const { data, error } = await supabase.rpc("accrue_verified_task", {
    p_task_id: taskId,
  });
  const accrual = (data as AccrualClaimRow[] | null)?.[0];

  if (error || !accrual) {
    throw new Error("The verified task could not be accrued.", {
      cause: error,
    });
  }

  return {
    accrualId: accrual.accrual_id,
    amountCents: accrual.amount_cents,
    currency: accrual.currency,
    paymentId: accrual.payment_id,
    replayed: accrual.replayed,
    status: accrual.status,
    userId: accrual.user_id,
  };
};
