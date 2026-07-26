import "server-only";

import { createClient } from "@/lib/supabase/server";

export type BillingAccountSummary = {
  id: string;
  providerPayerId: string | null;
  setupCompletedAt: string | null;
  status: "action_required" | "disabled" | "pending" | "ready";
};

export const getBillingAccountForUser = async (
  userId: string,
): Promise<BillingAccountSummary | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("billing_accounts")
    .select("id, provider_payer_id, setup_completed_at, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return null;
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    providerPayerId: data.provider_payer_id,
    setupCompletedAt: data.setup_completed_at,
    status: data.status,
  };
};

export const hasCompletedBillingSetup = async (userId: string) => {
  const billingAccount = await getBillingAccountForUser(userId);

  return billingAccount?.status === "ready";
};
