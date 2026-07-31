import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ConsoleNavigation } from "@/components/console/console-navigation";
import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";
import { hasCompletedBillingSetup } from "@/lib/billing/get-billing-account";

export const metadata: Metadata = {
  description: "Manage your Outcomes account, tasks, API keys, and billing.",
  title: {
    default: "Console — Outcomes",
    template: "%s — Outcomes",
  },
};

type ConsoleLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

const ConsoleLayout = async ({ children }: ConsoleLayoutProps) => {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/sign-in");
  }

  if (!(await hasCompletedBillingSetup(user.id))) {
    redirect("/billing/setup");
  }

  return (
    <div className="min-h-screen bg-ink text-paper">
      <ConsoleNavigation email={user.email ?? "Authenticated account"} />
      <main className="min-h-screen md:pl-56">{children}</main>
    </div>
  );
};

export default ConsoleLayout;
