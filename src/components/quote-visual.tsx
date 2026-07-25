"use client";

import { useEffect, useState } from "react";

const EXECUTION_COSTS = ["$6.14", "$9.42", "$7.83", "$11.06"];
const FIXED_TASK_PRICE = "$28.00";

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

      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full text-ink/35"
        fill="none"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <path
          d="M0 78C25 78 35 62 50 50S75 22 100 22"
          stroke="currentColor"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

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
