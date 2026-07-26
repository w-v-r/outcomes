"use client";

import { useActionState } from "react";

import {
  authenticate,
  type AuthFormState,
} from "@/app/(auth)/sign-in/actions";

const initialState: AuthFormState = {
  message: null,
  status: null,
};

export const AuthForm = () => {
  const [state, formAction, isPending] = useActionState(
    authenticate,
    initialState,
  );

  return (
    <form action={formAction} className="mt-10 space-y-6">
      <div>
        <label
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/55"
          htmlFor="email"
        >
          Work email
        </label>
        <input
          autoComplete="email"
          className="mt-2 w-full border border-paper/20 bg-paper/[0.04] px-4 py-3.5 text-base text-paper outline-none transition-colors placeholder:text-paper/30 focus:border-cobalt focus:bg-paper/[0.06]"
          id="email"
          name="email"
          placeholder="you@company.com"
          required
          type="email"
        />
      </div>

      <div>
        <div className="flex items-center justify-between gap-4">
          <label
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/55"
            htmlFor="password"
          >
            Password
          </label>
          <span className="text-xs text-paper/35">8 characters minimum</span>
        </div>
        <input
          autoComplete="current-password"
          className="mt-2 w-full border border-paper/20 bg-paper/[0.04] px-4 py-3.5 text-base text-paper outline-none transition-colors placeholder:text-paper/30 focus:border-cobalt focus:bg-paper/[0.06]"
          id="password"
          minLength={8}
          name="password"
          placeholder="Enter your password"
          required
          type="password"
        />
      </div>

      {state.message ? (
        <p
          className={
            state.status === "error"
              ? "border-l-2 border-coral bg-coral/10 px-4 py-3 text-sm leading-relaxed text-paper"
              : "border-l-2 border-cobalt bg-cobalt/10 px-4 py-3 text-sm leading-relaxed text-paper"
          }
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          className="inline-flex min-h-12 items-center justify-center bg-cobalt px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#4254ff] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt disabled:cursor-wait disabled:opacity-60"
          disabled={isPending}
          name="intent"
          type="submit"
          value="sign-in"
        >
          {isPending ? "Working…" : "Sign in"}
        </button>
        <button
          className="inline-flex min-h-12 items-center justify-center border border-paper/25 px-5 py-3 text-sm font-medium text-paper transition-colors hover:border-paper/60 hover:bg-paper/[0.05] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt disabled:cursor-wait disabled:opacity-60"
          disabled={isPending}
          name="intent"
          type="submit"
          value="sign-up"
        >
          Create account
        </button>
      </div>
    </form>
  );
};
