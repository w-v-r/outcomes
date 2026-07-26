"use client";

import Script from "next/script";
import { type FormEvent, useActionState, useState, useTransition } from "react";

import {
  completeSandboxBillingSetup,
  type BillingSetupState,
} from "@/app/(onboarding)/billing/setup/actions";

type CaptureTokenResult = {
  token?: string;
};

type PinchCaptureClient = {
  createToken: (details: {
    cardHolderName: string;
    cardNumber: string;
    cvc: string;
    expiryMonth: string;
    expiryYear: string;
    sourceType: "credit-card";
  }) => Promise<CaptureTokenResult>;
};

declare global {
  interface Window {
    Pinch?: {
      Capture: (configuration: {
        publishableKey: string;
      }) => PinchCaptureClient;
    };
  }
}

type SandboxBillingFormProps = {
  publishableKey: string;
};

const initialState: BillingSetupState = {
  message: null,
  status: null,
};

export const SandboxBillingForm = ({
  publishableKey,
}: SandboxBillingFormProps) => {
  const [state, formAction, isActionPending] = useActionState(
    completeSandboxBillingSetup,
    initialState,
  );
  const [isCaptureReady, setIsCaptureReady] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isTokenizing, startTokenTransition] = useTransition();
  const isPending = isActionPending || isTokenizing;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const firstName = String(formData.get("firstName") ?? "").trim();
    const lastName = String(formData.get("lastName") ?? "").trim();
    const captureFactory = window.Pinch?.Capture;

    if (!captureFactory) {
      setCaptureError("Pinch CaptureJS is still loading. Try again shortly.");
      return;
    }

    setCaptureError(null);
    startTokenTransition(async () => {
      try {
        const capture = captureFactory({ publishableKey });
        const result = await capture.createToken({
          cardHolderName: `${firstName} ${lastName}`.trim(),
          cardNumber: "4242424242424242",
          cvc: "123",
          expiryMonth: "12",
          expiryYear: "2030",
          sourceType: "credit-card",
        });

        if (!result.token) {
          throw new Error("Pinch returned no CaptureJS token.");
        }

        formData.set("captureToken", result.token);
        startTokenTransition(() => {
          formAction(formData);
        });
      } catch {
        setCaptureError(
          "The Pinch sandbox could not tokenize its standard test Visa. Try again.",
        );
      }
    });
  };

  return (
    <>
      <Script
        crossOrigin="anonymous"
        integrity="sha384-hglYFSKC4AMA/rAQOGB3OiA8u5ri5F4qNMGgw4I+fggDSlTmPyREcj1J+VGnkAX8"
        onError={() => {
          setCaptureError(
            "Pinch CaptureJS could not load. Check your connection and refresh.",
          );
        }}
        onReady={() => {
          setIsCaptureReady(true);
        }}
        src="https://cdn.getpinch.com.au/capturejs/pinch.capture.v2.js"
        strategy="afterInteractive"
      />

      <form className="mt-10 space-y-6" onSubmit={handleSubmit}>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/55"
              htmlFor="firstName"
            >
              First name
            </label>
            <input
              autoComplete="given-name"
              className="mt-2 w-full border border-paper/20 bg-paper/[0.04] px-4 py-3.5 text-base text-paper outline-none transition-colors placeholder:text-paper/30 focus:border-cobalt focus:bg-paper/[0.06]"
              id="firstName"
              maxLength={100}
              name="firstName"
              required
              type="text"
            />
          </div>

          <div>
            <label
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/55"
              htmlFor="lastName"
            >
              Last name
            </label>
            <input
              autoComplete="family-name"
              className="mt-2 w-full border border-paper/20 bg-paper/[0.04] px-4 py-3.5 text-base text-paper outline-none transition-colors placeholder:text-paper/30 focus:border-cobalt focus:bg-paper/[0.06]"
              id="lastName"
              maxLength={100}
              name="lastName"
              required
              type="text"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-4">
            <label
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/55"
              htmlFor="companyName"
            >
              Company
            </label>
            <span className="text-xs text-paper/35">Optional</span>
          </div>
          <input
            autoComplete="organization"
            className="mt-2 w-full border border-paper/20 bg-paper/[0.04] px-4 py-3.5 text-base text-paper outline-none transition-colors placeholder:text-paper/30 focus:border-cobalt focus:bg-paper/[0.06]"
            id="companyName"
            maxLength={160}
            name="companyName"
            placeholder="Your company"
            type="text"
          />
        </div>

        <div className="border border-paper/15 bg-paper/[0.035] p-5">
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper/40">
              Payment source
            </p>
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-cobalt">
              Test mode
            </span>
          </div>
          <div className="mt-5 flex items-center gap-4">
            <div
              aria-hidden="true"
              className="grid h-10 w-16 place-items-center border border-paper/20 bg-paper/[0.06] font-mono text-[9px] tracking-[0.1em]"
            >
              VISA
            </div>
            <div>
              <p className="text-sm text-paper">Pinch standard test card</p>
              <p className="mt-1 font-mono text-[10px] tracking-[0.12em] text-paper/35">
                •••• 4242 / never charged
              </p>
            </div>
          </div>
        </div>

        {captureError || state.message ? (
          <p
            className="border-l-2 border-coral bg-coral/10 px-4 py-3 text-sm leading-relaxed text-paper"
            role="alert"
          >
            {captureError ?? state.message}
          </p>
        ) : null}

        <button
          className="inline-flex min-h-12 w-full items-center justify-center bg-cobalt px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#4254ff] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt disabled:cursor-wait disabled:opacity-60"
          disabled={!isCaptureReady || isPending}
          type="submit"
        >
          {isPending
            ? "Creating sandbox profile…"
            : "Create sandbox billing profile"}
        </button>

        <p className="text-xs leading-relaxed text-paper/35">
          By continuing, you approve Outcomes to use this simulated source for
          explicitly approved sandbox task charges. No real payment details or
          funds are involved.
        </p>
      </form>
    </>
  );
};
