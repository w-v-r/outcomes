import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SandboxBillingForm } from "@/components/billing/sandbox-billing-form";
import { ConsoleWordmark } from "@/components/console/console-wordmark";
import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";
import { hasCompletedBillingSetup } from "@/lib/billing/get-billing-account";

export const metadata: Metadata = {
  title: "Sandbox billing — Outcomes",
  description: "Connect a Pinch Payments sandbox billing profile.",
};

const BillingSetupPage = async () => {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/sign-in");
  }

  if (await hasCompletedBillingSetup(user.id)) {
    redirect("/console");
  }

  const publishableKey = process.env.NEXT_PUBLIC_PINCH_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error("Missing NEXT_PUBLIC_PINCH_PUBLISHABLE_KEY.");
  }

  return (
    <main className="min-h-screen bg-ink text-paper">
      <header className="border-b border-paper/15">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <ConsoleWordmark compact />
          <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.17em] text-paper/40">
            <span className="size-1.5 bg-cobalt" aria-hidden="true" />
            Pinch sandbox
          </div>
        </div>
      </header>

      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-[1440px] lg:grid-cols-[minmax(0,0.9fr)_minmax(440px,0.7fr)]">
        <section className="flex items-center px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
          <div className="w-full max-w-xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cobalt">
              Billing setup / Test environment
            </p>
            <h1 className="mt-6 text-[clamp(3rem,7vw,6.8rem)] font-medium leading-[0.86] tracking-[-0.065em]">
              Connect the
              <br />
              <span className="font-serif font-normal italic text-paper/75">
                payment rail.
              </span>
            </h1>
            <p className="mt-7 max-w-lg text-base leading-relaxed text-paper/55">
              We’ll create your customer record in Pinch and attach its standard
              test Visa. This proves the complete billing path without
              collecting a real card or moving real money.
            </p>

            <SandboxBillingForm publishableKey={publishableKey} />
          </div>
        </section>

        <aside className="relative hidden border-l border-paper/15 bg-paper/[0.035] p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.17em] text-paper/40">
            <span>Payment contract</span>
            <span>Sandbox / 001</span>
          </div>

          <div className="my-16">
            <div className="relative pl-10">
              <div
                aria-hidden="true"
                className="absolute bottom-2 left-[7px] top-2 w-px bg-paper/15"
              />
              {[
                ["Identity", "Your confirmed Outcomes account"],
                ["Payer", "A customer record in Pinch test mode"],
                ["Source", "A reusable simulated Visa ending in 4242"],
                ["Charge", "Only after you approve and work is verified"],
              ].map(([label, description], index) => (
                <div
                  className="relative border-b border-paper/10 py-7 last:border-b-0"
                  key={label}
                >
                  <span
                    aria-hidden="true"
                    className="absolute -left-10 top-8 size-3 border border-cobalt bg-ink"
                  />
                  <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-cobalt">
                    0{index + 1} / {label}
                  </p>
                  <p className="mt-3 text-lg tracking-[-0.02em]">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm leading-relaxed text-paper/45">
              Pinch test mode exercises the same API operations as live mode,
              but no request reaches a bank.
            </p>
            <Link
              className="mt-6 inline-flex border-b border-paper/30 pb-1 text-sm text-paper transition-colors hover:border-cobalt hover:text-cobalt focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
              href="/"
            >
              Return to the public site
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
};

export default BillingSetupPage;
