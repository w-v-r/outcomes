"use client";

import { useEffect, useState } from "react";

const EXECUTION_COSTS = ["$6.14", "$9.42", "$7.83", "$11.06"];
const FIXED_TASK_PRICE = "$28.00";

const HandLinework = () => {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full text-ink/55"
      viewBox="0 0 760 500"
      fill="none"
    >
      <g
        className="draw-line"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      >
        <path d="M0 330c63-17 113-34 160-63 18-11 43-7 60 8l62 53" />
        <path d="M0 410c69-4 121-27 172-61 24-16 50-13 72 6l39 34" />
        <path d="M113 294c17-32 45-60 66-48 11 6 5 22-8 40" />
        <path d="M143 276c21-35 44-52 58-40 11 10 1 30-12 48" />
        <path d="M175 268c20-30 42-41 53-27 8 11-2 27-14 44" />
        <path d="M222 294l30 27 19 7" />
        <path d="M760 147c-59 13-106 27-153 54-21 12-47 10-65-6l-62-54" />
        <path d="M760 66c-70 3-123 25-175 58-24 15-49 11-70-8l-39-35" />
        <path d="M650 182c-19 31-47 58-68 45-10-6-4-23 9-40" />
        <path d="M620 199c-22 34-45 50-59 38-11-10 0-30 13-47" />
        <path d="M588 206c-21 30-43 39-54 25-8-11 3-27 15-44" />
        <path d="M542 179l-29-28-19-8" />
        <path d="M272 328c16-16 31-25 47-28" />
        <path d="M489 143c-17 15-33 23-49 26" />
      </g>
      <g fill="currentColor">
        <circle cx="112" cy="294" r="2" />
        <circle cx="649" cy="182" r="2" />
      </g>
    </svg>
  );
};

export const QuoteVisual = () => {
  const [costIndex, setCostIndex] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCostIndex((currentIndex) => {
        return (currentIndex + 1) % EXECUTION_COSTS.length;
      });
    }, 2200);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className="relative isolate min-h-[430px] overflow-hidden border-x border-b border-ink/15 bg-[#ecece7] sm:min-h-[500px]">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(17,18,16,.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(17,18,16,.07) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <HandLinework />

      <div className="float-paper absolute left-1/2 top-1/2 w-[82%] max-w-[430px] -translate-x-1/2 -translate-y-1/2 border border-ink bg-paper p-5 shadow-[10px_12px_0_#111210] sm:p-7">
        <div className="flex items-center justify-between border-b border-ink/20 pb-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            Outcome contract / 0041
          </p>
          <span className="pulse-proof size-2.5 rounded-full bg-cobalt" />
        </div>

        <div className="py-6 sm:py-8">
          <p className="max-w-[310px] text-xl font-medium leading-tight tracking-[-0.025em] sm:text-2xl">
            Make the failing checkout test pass without changing the public API.
          </p>
        </div>

        <div className="grid grid-cols-2 border-y border-ink">
          <div className="border-r border-ink py-4 pr-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
              Your fixed price
            </p>
            <p className="mt-2 font-mono text-2xl font-medium tracking-[-0.04em] sm:text-3xl">
              {FIXED_TASK_PRICE}
            </p>
          </div>
          <div className="py-4 pl-4">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
              Our execution cost
            </p>
            <p
              aria-live="polite"
              className="mt-2 font-mono text-2xl tracking-[-0.04em] text-muted transition-opacity sm:text-3xl"
            >
              {EXECUTION_COSTS[costIndex]}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            Price locked before execution
          </p>
          <svg
            aria-hidden="true"
            className="size-5 text-cobalt"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="m5 12 4 4L19 6" />
          </svg>
        </div>
      </div>

      <p className="absolute bottom-4 left-4 font-mono text-[9px] uppercase tracking-[0.18em] text-muted sm:bottom-6 sm:left-6">
        Variable underneath. Stable on top.
      </p>
      <p className="absolute bottom-4 right-4 font-mono text-[9px] uppercase tracking-[0.18em] text-muted sm:bottom-6 sm:right-6">
        Illustrative quote
      </p>
    </div>
  );
};
