import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { ConsoleWordmark } from "@/components/console/console-wordmark";
import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";

export const metadata: Metadata = {
  title: "Sign in — Outcomes",
  description: "Sign in to the Outcomes Console.",
};

type SignInPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

const SignInPage = async ({ searchParams }: SignInPageProps) => {
  const [user, query] = await Promise.all([
    getAuthenticatedUser(),
    searchParams,
  ]);

  if (user) {
    redirect("/dashboard");
  }

  const hasCallbackError = Boolean(query.error);

  return (
    <main className="min-h-screen bg-ink text-paper">
      <header className="border-b border-paper/15">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <ConsoleWordmark compact />
          <Link
            className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper/50 transition-colors hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
            href="/"
          >
            Back to site
          </Link>
        </div>
      </header>

      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-[1440px] lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,0.7fr)]">
        <section className="flex items-center px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
          <div className="w-full max-w-xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cobalt">
              Customer access
            </p>
            <h1 className="mt-6 text-[clamp(3rem,7vw,6.8rem)] font-medium leading-[0.86] tracking-[-0.065em]">
              Your work,
              <br />
              <span className="font-serif font-normal italic text-paper/75">
                accounted for.
              </span>
            </h1>
            <p className="mt-7 max-w-md text-base leading-relaxed text-paper/55">
              Sign in to review fixed-price work, evidence, usage, and payment
              status in one place.
            </p>

            {hasCallbackError ? (
              <p
                className="mt-7 border-l-2 border-coral bg-coral/10 px-4 py-3 text-sm leading-relaxed"
                role="alert"
              >
                That sign-in link is invalid or has expired. Start again below.
              </p>
            ) : null}

            <AuthForm />

            <p className="mt-6 text-xs leading-relaxed text-paper/35">
              By continuing, you agree to use Outcomes for authorized
              repositories and tasks only.
            </p>
          </div>
        </section>

        <aside className="relative hidden border-l border-paper/15 bg-paper/[0.035] p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.17em] text-paper/40">
            <span>Outcome contract</span>
            <span>Preview / 001</span>
          </div>

          <div className="my-16 border-y border-paper/15">
            <div className="grid grid-cols-[72px_1fr] border-b border-paper/15 py-7">
              <span className="font-mono text-xs text-cobalt">01</span>
              <div>
                <p className="text-lg tracking-[-0.02em]">Price before work</p>
                <p className="mt-2 text-sm leading-relaxed text-paper/45">
                  Agree to one fixed quote before an agent begins.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-[72px_1fr] border-b border-paper/15 py-7">
              <span className="font-mono text-xs text-cobalt">02</span>
              <div>
                <p className="text-lg tracking-[-0.02em]">Proof after work</p>
                <p className="mt-2 text-sm leading-relaxed text-paper/45">
                  Inspect the result against explicit acceptance criteria.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-[72px_1fr] py-7">
              <span className="font-mono text-xs text-cobalt">03</span>
              <div>
                <p className="text-lg tracking-[-0.02em]">Payment by outcome</p>
                <p className="mt-2 text-sm leading-relaxed text-paper/45">
                  Track the financial state alongside the delivered result.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.17em] text-paper/40">
            <span className="size-2 bg-cobalt" aria-hidden="true" />
            Supabase identity / encrypted session
          </div>
        </aside>
      </div>
    </main>
  );
};

export default SignInPage;
