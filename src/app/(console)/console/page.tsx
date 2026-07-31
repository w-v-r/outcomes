import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/console/page-header";
import { StatusBadge } from "@/components/console/status-badge";
import { listCustomerApiKeys } from "@/lib/api-keys/service";
import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";
import { getBillingAccountForUser } from "@/lib/billing/get-billing-account";
import { getIdentityDetails } from "@/lib/console/data";
import { formatConsoleDate } from "@/lib/console/format";
import { listGitHubInstallations } from "@/lib/github-app/installations";

export const metadata: Metadata = {
  title: "Overview",
};

const OverviewPage = async () => {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/sign-in");
  }

  const [identity, billingAccount, apiKeys, githubInstallations] =
    await Promise.all([
      getIdentityDetails(user.id),
      getBillingAccountForUser(user.id),
      listCustomerApiKeys(user.id).catch(() => []),
      listGitHubInstallations(user.id).catch(() => []),
    ]);
  const displayName = [identity.firstName, identity.lastName]
    .filter(Boolean)
    .join(" ");
  const activeApiKeyCount = apiKeys.filter(
    (apiKey) => !apiKey.revokedAt,
  ).length;

  return (
    <>
      <PageHeader
        description="Your account and connected services."
        title="Overview"
      />

      <div className="max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <section aria-labelledby="identity-heading">
          <h2
            className="text-xs font-medium uppercase tracking-[0.08em] text-paper/40"
            id="identity-heading"
          >
            Identity
          </h2>
          <dl className="mt-4 divide-y divide-paper/10 border-y border-paper/10">
            <div className="grid gap-1 py-4 sm:grid-cols-[180px_1fr] sm:items-center">
              <dt className="text-sm text-paper/45">Email</dt>
              <dd className="text-sm text-paper">
                {user.email ?? "Not available"}
              </dd>
            </div>
            <div className="grid gap-1 py-4 sm:grid-cols-[180px_1fr] sm:items-center">
              <dt className="text-sm text-paper/45">Name</dt>
              <dd className="text-sm text-paper">
                {displayName || "Not provided"}
              </dd>
            </div>
            <div className="grid gap-1 py-4 sm:grid-cols-[180px_1fr] sm:items-center">
              <dt className="text-sm text-paper/45">Company</dt>
              <dd className="text-sm text-paper">
                {identity.companyName ?? "Not provided"}
              </dd>
            </div>
            <div className="grid gap-1 py-4 sm:grid-cols-[180px_1fr] sm:items-center">
              <dt className="text-sm text-paper/45">Member since</dt>
              <dd className="text-sm text-paper">
                {formatConsoleDate(identity.createdAt)}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="connections-heading" className="mt-10">
          <h2
            className="text-xs font-medium uppercase tracking-[0.08em] text-paper/40"
            id="connections-heading"
          >
            Connections
          </h2>
          <div className="mt-4 grid border-y border-paper/10 sm:grid-cols-3 sm:divide-x sm:divide-paper/10">
            <div className="border-b border-paper/10 py-5 sm:border-b-0 sm:pr-5">
              <p className="text-sm text-paper/45">Billing</p>
              <div className="mt-3">
                <StatusBadge status={billingAccount?.status ?? "pending"} />
              </div>
            </div>
            <div className="border-b border-paper/10 py-5 sm:border-b-0 sm:px-5">
              <p className="text-sm text-paper/45">API keys</p>
              <p className="mt-2 font-mono text-2xl tracking-[-0.04em] text-paper">
                {activeApiKeyCount}
              </p>
            </div>
            <div className="py-5 sm:pl-5">
              <p className="text-sm text-paper/45">GitHub accounts</p>
              <p className="mt-2 font-mono text-2xl tracking-[-0.04em] text-paper">
                {githubInstallations.length}
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
};

export default OverviewPage;
