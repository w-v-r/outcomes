import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/console/page-header";
import { StatusBadge } from "@/components/console/status-badge";
import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";
import { getBillingDetails } from "@/lib/console/data";
import {
  formatConsoleDate,
  formatCurrency,
} from "@/lib/console/format";

export const metadata: Metadata = {
  title: "Billing",
};

const BillingPage = async () => {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/sign-in");
  }

  const billing = await getBillingDetails(user.id);
  const paidCents = billing.payments
    .filter((payment) =>
      ["approved", "pending", "settled"].includes(payment.status),
    )
    .reduce((total, payment) => total + payment.amountCents, 0);
  const paymentSourceLabel = billing.paymentSource
    ? `${billing.paymentSource.cardScheme?.toUpperCase() ?? "CARD"} •••• ${billing.paymentSource.lastFour ?? "—"}`
    : "No payment method";

  return (
    <>
      <PageHeader
        description="Outstanding verified work and batched payment history."
        title="Billing"
      />

      <div className="max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <section
          aria-label="Billing summary"
          className="grid border-y border-paper/10 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-paper/10"
        >
          <div className="border-b border-paper/10 py-6 sm:pr-6 lg:border-b-0">
            <p className="text-xs text-paper/45">Outstanding</p>
            <p className="mt-2 font-mono text-3xl tracking-[-0.05em] text-paper">
              {formatCurrency(billing.outstandingCents)}
            </p>
            <p className="mt-2 text-xs text-paper/35">
              Collected when the balance reaches $10.
            </p>
          </div>
          <div className="border-b border-paper/10 py-6 sm:pl-6 lg:border-b-0 lg:px-6">
            <p className="text-xs text-paper/45">Processing</p>
            <p className="mt-2 font-mono text-3xl tracking-[-0.05em] text-paper">
              {formatCurrency(billing.inProgressCents)}
            </p>
          </div>
          <div className="border-b border-paper/10 py-6 sm:pr-6 lg:border-b-0 lg:px-6">
            <p className="text-xs text-paper/45">Paid</p>
            <p className="mt-2 font-mono text-3xl tracking-[-0.05em] text-paper">
              {formatCurrency(paidCents)}
            </p>
          </div>
          <div className="py-6 sm:pl-6">
            <p className="text-xs text-paper/45">Account</p>
            <div className="mt-3">
              <StatusBadge status={billing.accountStatus ?? "pending"} />
            </div>
          </div>
        </section>

        <section aria-labelledby="payment-method-heading" className="mt-10">
          <h2
            className="text-xs font-medium uppercase tracking-[0.08em] text-paper/40"
            id="payment-method-heading"
          >
            Payment method
          </h2>
          <div className="mt-4 flex items-center justify-between gap-4 border-y border-paper/10 py-4">
            <div>
              <p className="font-mono text-sm text-paper">
                {paymentSourceLabel}
              </p>
              {billing.paymentSource?.displayName ? (
                <p className="mt-1 text-xs text-paper/40">
                  {billing.paymentSource.displayName}
                </p>
              ) : null}
            </div>
            <span className="text-xs text-paper/40">Default</span>
          </div>
        </section>

        <section aria-labelledby="history-heading" className="mt-10">
          <h2
            className="text-xs font-medium uppercase tracking-[0.08em] text-paper/40"
            id="history-heading"
          >
            Payment history
          </h2>
          <div className="mt-4 overflow-x-auto border-y border-paper/10">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="border-b border-paper/10 text-[11px] font-medium uppercase tracking-[0.07em] text-paper/40">
                  <th className="px-3 py-3 font-medium" scope="col">
                    Work
                  </th>
                  <th className="px-3 py-3 font-medium" scope="col">
                    Date
                  </th>
                  <th className="px-3 py-3 font-medium" scope="col">
                    Status
                  </th>
                  <th
                    className="px-3 py-3 text-right font-medium"
                    scope="col"
                  >
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper/10">
                {billing.payments.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-12 text-center text-sm text-paper/45"
                      colSpan={4}
                    >
                      No payments yet.
                    </td>
                  </tr>
                ) : (
                  billing.payments.map((payment) => (
                    <tr className="text-sm" key={payment.id}>
                      <th className="px-3 py-4 font-normal" scope="row">
                        <p className="font-medium text-paper">
                          {payment.taskTitles.length === 0
                            ? "Legacy payment"
                            : `${payment.taskTitles.length} ${
                                payment.taskTitles.length === 1
                                  ? "task"
                                  : "tasks"
                              }`}
                        </p>
                        {payment.taskTitles.length > 0 ? (
                          <p className="mt-1 max-w-sm text-xs text-paper/40">
                            {payment.taskTitles.join(", ")}
                          </p>
                        ) : null}
                      </th>
                      <td className="whitespace-nowrap px-3 py-4 text-paper/45">
                        {formatConsoleDate(
                          payment.chargedAt ?? payment.createdAt,
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <StatusBadge status={payment.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-right font-mono text-xs text-paper">
                        {formatCurrency(
                          payment.amountCents,
                          payment.currency,
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
};

export default BillingPage;
