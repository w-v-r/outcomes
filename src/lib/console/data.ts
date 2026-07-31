import "server-only";

import { createClient } from "@/lib/supabase/server";

export type ConsoleTask = {
  amountCents: number | null;
  completedAt: string | null;
  createdAt: string;
  currency: string;
  id: string;
  paymentStatus: string | null;
  resultPrUrl: string | null;
  status: string;
  title: string;
  updatedAt: string;
};

export type BillingPayment = {
  amountCents: number;
  chargedAt: string | null;
  createdAt: string;
  currency: string;
  id: string;
  providerPaymentId: string | null;
  status: string;
  taskTitle: string;
};

export type BillingDetails = {
  accountStatus: string | null;
  paymentSource: {
    cardScheme: string | null;
    displayName: string | null;
    lastFour: string | null;
  } | null;
  payments: BillingPayment[];
};

export type IdentityDetails = {
  companyName: string | null;
  createdAt: string | null;
  firstName: string | null;
  lastName: string | null;
};

export const getConsoleTasks = async (
  userId: string,
): Promise<ConsoleTask[]> => {
  const supabase = await createClient();
  const [{ data: tasks, error: tasksError }, { data: quotes, error: quotesError }, { data: payments, error: paymentsError }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id, title, status, created_at, updated_at, completed_at, result_pr_url",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("quotes")
        .select("task_id, amount_cents, currency")
        .eq("user_id", userId),
      supabase
        .from("payments")
        .select("task_id, status")
        .eq("user_id", userId),
    ]);

  if (tasksError || quotesError || paymentsError) {
    throw new Error("Tasks could not be loaded.", {
      cause: tasksError ?? quotesError ?? paymentsError,
    });
  }

  const quoteByTaskId = new Map(
    (quotes ?? [])
      .filter((quote) => quote.task_id)
      .map((quote) => [quote.task_id, quote]),
  );
  const paymentByTaskId = new Map(
    (payments ?? []).map((payment) => [payment.task_id, payment]),
  );

  return (tasks ?? []).map((task) => {
    const quote = quoteByTaskId.get(task.id);
    const payment = paymentByTaskId.get(task.id);

    return {
      amountCents: quote?.amount_cents ?? null,
      completedAt: task.completed_at,
      createdAt: task.created_at,
      currency: quote?.currency ?? "AUD",
      id: task.id,
      paymentStatus: payment?.status ?? null,
      resultPrUrl: task.result_pr_url,
      status: task.status,
      title: task.title,
      updatedAt: task.updated_at,
    };
  });
};

export const getBillingDetails = async (
  userId: string,
): Promise<BillingDetails> => {
  const supabase = await createClient();
  const [
    { data: billingAccount, error: accountError },
    { data: paymentSource, error: sourceError },
    { data: payments, error: paymentsError },
    { data: tasks, error: tasksError },
  ] = await Promise.all([
    supabase
      .from("billing_accounts")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("payment_sources")
      .select("card_scheme, display_name, last_four")
      .eq("user_id", userId)
      .eq("is_default", true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("payments")
      .select(
        "id, task_id, amount_cents, currency, status, provider_payment_id, charged_at, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase.from("tasks").select("id, title").eq("user_id", userId),
  ]);

  if (accountError || sourceError || paymentsError || tasksError) {
    throw new Error("Billing details could not be loaded.", {
      cause: accountError ?? sourceError ?? paymentsError ?? tasksError,
    });
  }

  const taskTitleById = new Map(
    (tasks ?? []).map((task) => [task.id, task.title]),
  );

  return {
    accountStatus: billingAccount?.status ?? null,
    paymentSource: paymentSource
      ? {
          cardScheme: paymentSource.card_scheme,
          displayName: paymentSource.display_name,
          lastFour: paymentSource.last_four,
        }
      : null,
    payments: (payments ?? []).map((payment) => ({
      amountCents: payment.amount_cents,
      chargedAt: payment.charged_at,
      createdAt: payment.created_at,
      currency: payment.currency,
      id: payment.id,
      providerPaymentId: payment.provider_payment_id,
      status: payment.status,
      taskTitle: taskTitleById.get(payment.task_id) ?? "Task",
    })),
  };
};

export const getIdentityDetails = async (
  userId: string,
): Promise<IdentityDetails> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("company_name, created_at, first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Account details could not be loaded.", { cause: error });
  }

  return {
    companyName: data?.company_name ?? null,
    createdAt: data?.created_at ?? null,
    firstName: data?.first_name ?? null,
    lastName: data?.last_name ?? null,
  };
};
