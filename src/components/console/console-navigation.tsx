"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { signOut } from "@/app/(console)/console/actions";

const navigationItems = [
  { href: "/console", label: "Overview" },
  { href: "/console/tasks", label: "Tasks" },
  { href: "/console/dashboard", label: "Dashboard" },
  { href: "/console/api-keys", label: "API keys" },
  { href: "/console/billing", label: "Billing" },
] as const;

const isCurrentRoute = (pathname: string, href: string) => {
  if (href === "/console") {
    return pathname === href;
  }

  return pathname.startsWith(href);
};

type ConsoleNavigationProps = {
  email: string;
};

export const ConsoleNavigation = ({ email }: ConsoleNavigationProps) => {
  const pathname = usePathname();

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-paper/10 bg-ink px-5 md:hidden">
        <Link
          aria-label="Outcomes console overview"
          className="flex items-center gap-2 text-sm font-semibold tracking-[-0.02em] text-paper focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
          href="/console"
        >
          <span className="grid size-6 place-items-center rounded-md bg-paper text-[11px] font-semibold text-ink">
            O
          </span>
          Outcomes
        </Link>
        <form action={signOut}>
          <button
            className="text-xs text-paper/45 transition-colors hover:text-paper focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
            type="submit"
          >
            Sign out
          </button>
        </form>
      </header>

      <nav
        aria-label="Console navigation"
        className="overflow-x-auto border-b border-paper/10 bg-ink px-3 md:hidden"
      >
        <ul className="flex min-w-max">
          {navigationItems.map((item) => {
            const isCurrent = isCurrentRoute(pathname, item.href);
            const currentClasses = isCurrent
              ? "border-paper text-paper"
              : "border-transparent text-paper/45 hover:text-paper";

            return (
              <li key={item.href}>
                <Link
                  aria-current={isCurrent ? "page" : undefined}
                  className={`block border-b px-3 py-3 text-xs font-medium transition-colors focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cobalt ${currentClasses}`}
                  href={item.href}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <aside className="fixed inset-y-0 left-0 hidden w-56 border-r border-paper/10 bg-[#151714] md:flex md:flex-col">
        <div className="px-5 pt-5">
          <Link
            aria-label="Outcomes console overview"
            className="inline-flex items-center gap-2.5 text-sm font-semibold tracking-[-0.02em] text-paper focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
            href="/console"
          >
            <span className="grid size-7 place-items-center rounded-md bg-paper text-xs font-semibold text-ink">
              O
            </span>
            Outcomes
          </Link>
        </div>

        <nav aria-label="Console navigation" className="mt-8 px-3">
          <ul className="space-y-0.5">
            {navigationItems.map((item) => {
              const isCurrent = isCurrentRoute(pathname, item.href);
              const currentClasses = isCurrent
                ? "bg-paper/[0.075] text-paper"
                : "text-paper/45 hover:bg-paper/[0.045] hover:text-paper";

              return (
                <li key={item.href}>
                  <Link
                    aria-current={isCurrent ? "page" : undefined}
                    className={`block rounded-md px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt ${currentClasses}`}
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-auto border-t border-paper/10 p-5">
          <p className="truncate text-xs text-paper/70">{email}</p>
          <form action={signOut} className="mt-2">
            <button
              className="text-xs text-paper/40 transition-colors hover:text-paper focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
              type="submit"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
};
