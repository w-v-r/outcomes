import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConsoleWordmark } from "@/components/console/console-wordmark";
import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";
import { hasCompletedBillingSetup } from "@/lib/billing/get-billing-account";

import { signOut } from "./actions";

export const metadata: Metadata = {
  title: "Console — Outcomes",
  description: "Manage your Outcomes account, work, and usage.",
};

type DashboardLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

const SignOutButton = () => {
  return (
    <form action={signOut}>
      <button
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper/45 transition-colors hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
        type="submit"
      >
        Sign out
      </button>
    </form>
  );
};

const DashboardLayout = async ({ children }: DashboardLayoutProps) => {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/sign-in");
  }

  if (!(await hasCompletedBillingSetup(user.id))) {
    redirect("/billing/setup");
  }

  return (
    <div className="min-h-screen bg-ink text-paper">
      <header className="flex h-16 items-center justify-between border-b border-paper/15 px-5 lg:hidden">
        <ConsoleWordmark compact />
        <SignOutButton />
      </header>

      <div className="mx-auto min-h-screen max-w-[1600px] lg:grid lg:grid-cols-[272px_1fr]">
        <aside className="sticky top-0 hidden h-screen border-r border-paper/15 bg-paper/[0.025] px-7 py-7 lg:flex lg:flex-col">
          <ConsoleWordmark />

          <nav aria-label="Console navigation" className="mt-16">
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/30">
              Workspace
            </p>
            <Link
              aria-current="page"
              className="mt-4 flex items-center justify-between border-l-2 border-cobalt bg-paper/[0.055] px-4 py-3 text-sm text-paper focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
              href="/dashboard"
            >
              Overview
              <span
                aria-hidden="true"
                className="font-mono text-[10px] text-paper/35"
              >
                01
              </span>
            </Link>
          </nav>

          <div className="mt-10 border-t border-paper/10 pt-6">
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/30">
              System
            </p>
            <div className="mt-4 flex items-center gap-3 text-xs text-paper/50">
              <span className="size-1.5 bg-cobalt" aria-hidden="true" />
              Identity connected
            </div>
          </div>

          <div className="mt-auto border-t border-paper/15 pt-6">
            <p className="truncate text-sm text-paper/70">
              {user.email ?? "Authenticated account"}
            </p>
            <div className="mt-3 flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.17em] text-paper/30">
                Customer
              </span>
              <SignOutButton />
            </div>
          </div>
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
};

export default DashboardLayout;
