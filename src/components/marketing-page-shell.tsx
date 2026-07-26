import Link from "next/link";
import type { ReactNode } from "react";

type MarketingPageShellProps = Readonly<{
  children: ReactNode;
  eyebrow: string;
  title: string;
}>;

export const MarketingPageShell = ({
  children,
  eyebrow,
  title,
}: MarketingPageShellProps) => {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        className="fixed left-3 top-3 z-50 -translate-y-20 bg-ink px-4 py-3 text-sm text-white transition-transform focus:translate-y-0"
        href="#main-content"
      >
        Skip to content
      </a>

      <header className="border-b border-ink/15">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link
            aria-label="Outcomes home"
            className="group inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.15em]"
            href="/"
          >
            <span className="grid size-6 place-items-center border border-ink bg-ink text-paper transition-colors group-hover:bg-cobalt">
              O
            </span>
            Outcomes
          </Link>
          <Link
            className="text-sm text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
            href="/"
          >
            Back home
          </Link>
        </div>
      </header>

      <main
        className="mx-auto flex w-full max-w-[1440px] flex-1 px-5 py-20 sm:px-8 sm:py-28 lg:px-12 lg:py-36"
        id="main-content"
      >
        <article className="w-full">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            {eyebrow}
          </p>
          <h1 className="mt-6 max-w-5xl text-[clamp(3.5rem,9vw,8.5rem)] font-medium leading-[0.86] tracking-[-0.07em]">
            {title}
          </h1>
          <div className="mt-16 max-w-2xl border-t border-ink pt-7 sm:mt-24">
            {children}
          </div>
        </article>
      </main>

      <footer className="border-t border-ink/15">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-8 font-mono text-[9px] uppercase tracking-[0.14em] text-muted sm:px-8 lg:px-12">
          <span>Outcomes</span>
          <span>Sydney / 2026</span>
        </div>
      </footer>
    </div>
  );
};
