import Link from "next/link";
import { redirect } from "next/navigation";

import { SandboxPaymentDemo } from "@/components/billing/sandbox-payment-demo";
import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";
import { createClient } from "@/lib/supabase/server";

const DashboardPage = async () => {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/sign-in");
  }

  const supabase = await createClient();
  const [{ data: billingAccount }, { data: latestTask }] = await Promise.all([
    supabase
      .from("billing_accounts")
      .select("id, provider_payer_id, status")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("id, title, status")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const [{ data: paymentSource }, { data: quote }, { data: payment }] =
    await Promise.all([
      billingAccount
        ? supabase
            .from("payment_sources")
            .select("card_scheme, last_four")
            .eq("billing_account_id", billingAccount.id)
            .eq("user_id", user.id)
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      latestTask
        ? supabase
            .from("quotes")
            .select("id, amount_cents, status, terms")
            .eq("task_id", latestTask.id)
            .eq("user_id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      latestTask
        ? supabase
            .from("payments")
            .select("provider_payment_id, status")
            .eq("task_id", latestTask.id)
            .eq("user_id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-paper/15 px-5 py-5 sm:px-8 lg:px-12">
        <div className="flex items-center justify-between gap-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.19em] text-paper/40">
            Control plane / Payments
          </p>
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.17em] text-paper/35">
            <span className="size-1.5 bg-cobalt" aria-hidden="true" />
            Pinch test environment
          </div>
        </div>
      </header>

      <div className="px-5 py-12 sm:px-8 sm:py-16 lg:px-12 lg:py-20">
        <section className="max-w-5xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cobalt">
            Sandbox payment rail
          </p>
          <h1 className="mt-6 text-[clamp(3rem,7vw,7.2rem)] font-medium leading-[0.86] tracking-[-0.07em]">
            Quote. Prove.
            <br />
            <span className="font-serif font-normal italic text-paper/65">
              Then charge.
            </span>
          </h1>
          <p className="mt-8 max-w-2xl text-base leading-relaxed text-paper/50 sm:text-lg">
            This console demonstrates the complete Outcomes contract: persist a
            fixed quote, record explicit approval, verify the work, then submit
            exactly one payment to Pinch.
          </p>
        </section>

        <section
          aria-labelledby="foundation-status"
          className="mt-16 border-y border-paper/15"
        >
          <h2 className="sr-only" id="foundation-status">
            Sandbox integration status
          </h2>
          <div className="grid md:grid-cols-3">
            <div className="border-b border-paper/15 py-7 md:border-b-0 md:border-r md:pr-8">
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/35">
                  Identity
                </p>
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-cobalt">
                  Confirmed
                </span>
              </div>
              <p className="mt-5 text-xl tracking-[-0.03em]">
                {user.email}
              </p>
            </div>

            <div className="border-b border-paper/15 py-7 md:border-b-0 md:border-r md:px-8">
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/35">
                  Pinch payer
                </p>
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-cobalt">
                  {billingAccount?.status ?? "pending"}
                </span>
              </div>
              <p className="mt-5 text-xl tracking-[-0.03em]">
                {billingAccount?.provider_payer_id ?? "Not connected"}
              </p>
            </div>

            <div className="py-7 md:pl-8">
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/35">
                  Test source
                </p>
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-cobalt">
                  Vaulted
                </span>
              </div>
              <p className="mt-5 text-xl tracking-[-0.03em]">
                {paymentSource
                  ? `${paymentSource.card_scheme?.toUpperCase() ?? "CARD"} •••• ${paymentSource.last_four}`
                  : "Awaiting source"}
              </p>
            </div>
          </div>
        </section>

        <section aria-label="Pinch sandbox payment demonstration" className="mt-16">
          <SandboxPaymentDemo
            payment={
              payment
                ? {
                    providerPaymentId: payment.provider_payment_id,
                    status: payment.status,
                  }
                : null
            }
            quote={
              quote
                ? {
                    amountCents: quote.amount_cents,
                    id: quote.id,
                    status: quote.status,
                    terms: quote.terms,
                  }
                : null
            }
            task={
              latestTask
                ? {
                    id: latestTask.id,
                    status: latestTask.status,
                    title: latestTask.title,
                  }
                : null
            }
          />
        </section>

        <div className="mt-12 flex flex-col justify-between gap-6 border-t border-paper/15 pt-6 text-sm text-paper/40 sm:flex-row sm:items-center">
          <p>
            Sandbox only. No real card details are collected and no real funds
            move.
          </p>
          <Link
            className="w-fit border-b border-paper/30 pb-1 text-paper transition-colors hover:border-cobalt hover:text-cobalt focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
            href="/"
          >
            Return to the public site
          </Link>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
