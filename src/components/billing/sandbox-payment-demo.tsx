"use client";

import { useActionState } from "react";

import {
  approveSandboxDemoQuote,
  completeAndAccrueSandboxTask,
  createSandboxDemoQuote,
  settleSandboxBalance,
  type DemoActionState,
} from "@/app/(console)/dashboard/payment-actions";

type SandboxPaymentDemoProps = {
  payment: {
    providerPaymentId: string | null;
    status: string;
  } | null;
  quote: {
    amountCents: number;
    id: string;
    status: string;
    terms: string;
  } | null;
  task: {
    id: string;
    status: string;
    title: string;
  } | null;
};

const initialState: DemoActionState = {
  message: null,
  status: null,
};

const formatCurrency = (amountCents: number) =>
  new Intl.NumberFormat("en-AU", {
    currency: "AUD",
    style: "currency",
  }).format(amountCents / 100);

export const SandboxPaymentDemo = ({
  payment,
  quote,
  task,
}: SandboxPaymentDemoProps) => {
  const [createState, createAction, isCreating] = useActionState(
    createSandboxDemoQuote,
    initialState,
  );
  const [approveState, approveAction, isApproving] = useActionState(
    approveSandboxDemoQuote,
    initialState,
  );
  const [completeState, completeAction, isCompleting] = useActionState(
    completeAndAccrueSandboxTask,
    initialState,
  );
  const [settleState, settleAction, isSettling] = useActionState(
    settleSandboxBalance,
    initialState,
  );
  const actionState =
    settleState.message !== null
      ? settleState
      : completeState.message !== null
        ? completeState
        : approveState.message !== null
          ? approveState
          : createState;

  if (!task || !quote) {
    return (
      <div className="border border-paper/15 bg-paper/[0.025] p-6 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/35">
            Judge demo / Step 1
          </p>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-cobalt">
            Ready
          </span>
        </div>
        <h2 className="mt-5 text-2xl tracking-[-0.04em]">
          Create a priced task
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-paper/45">
          The demo pricing model will persist an immutable AUD 12.50 quote.
          Nothing is charged until that exact quote is approved and the task is
          verified.
        </p>
        <form action={createAction} className="mt-8">
          <button
            className="inline-flex min-h-11 items-center justify-center bg-cobalt px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#4254ff] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt disabled:cursor-wait disabled:opacity-60"
            disabled={isCreating}
            type="submit"
          >
            {isCreating ? "Creating quote…" : "Create AUD 12.50 quote"}
          </button>
        </form>
        {createState.message ? (
          <p
            className="mt-5 border-l-2 border-coral bg-coral/10 px-4 py-3 text-sm leading-relaxed"
            role="alert"
          >
            {createState.message}
          </p>
        ) : null}
      </div>
    );
  }

  const quoteApproved = quote.status === "approved";
  const taskCompleted = task.status === "completed";

  return (
    <div className="border border-paper/15 bg-paper/[0.025]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-paper/15 p-6 sm:px-8">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/35">
            Judge demo / Payment lifecycle
          </p>
          <h2 className="mt-3 text-2xl tracking-[-0.04em]">{task.title}</h2>
        </div>
        <div className="text-right">
          <p className="font-serif text-4xl italic text-paper">
            {formatCurrency(quote.amountCents)}
          </p>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-paper/30">
            Fixed / AUD
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-3">
        <div className="border-b border-paper/15 p-6 md:border-b-0 md:border-r sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper/35">
              01 / Quote
            </p>
            <span
              className="font-mono text-[9px] uppercase tracking-[0.14em] text-cobalt"
              data-status={quote.status}
            >
              {quote.status}
            </span>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-paper/50">
            {quote.terms}
          </p>
          {!quoteApproved ? (
            <form action={approveAction} className="mt-7">
              <input name="quoteId" type="hidden" value={quote.id} />
              <button
                className="inline-flex min-h-10 w-full items-center justify-center border border-cobalt bg-cobalt/10 px-4 py-2 text-sm text-paper transition-colors hover:bg-cobalt hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt disabled:cursor-wait disabled:opacity-60"
                disabled={isApproving}
                type="submit"
              >
                {isApproving ? "Recording approval…" : "Approve exact quote"}
              </button>
            </form>
          ) : (
            <p className="mt-7 font-mono text-[9px] uppercase tracking-[0.15em] text-cobalt">
              Customer approval recorded
            </p>
          )}
        </div>

        <div className="border-b border-paper/15 p-6 md:border-b-0 md:border-r sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper/35">
              02 / Work
            </p>
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper/45">
              {task.status}
            </span>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-paper/50">
            One control simulates worker completion, verifies the acceptance
            criteria, and accrues the approved quote without calling Pinch.
          </p>
          {quoteApproved && !taskCompleted ? (
            <form action={completeAction} className="mt-7">
              <input name="taskId" type="hidden" value={task.id} />
              <button
                className="inline-flex min-h-10 w-full items-center justify-center border border-paper/25 px-4 py-2 text-sm text-paper transition-colors hover:border-cobalt hover:text-cobalt focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt disabled:cursor-wait disabled:opacity-60"
                disabled={isCompleting}
                type="submit"
              >
                {isCompleting
                  ? "Verifying and accruing…"
                  : "Complete, verify, and accrue"}
              </button>
            </form>
          ) : (
            <p className="mt-7 font-mono text-[9px] uppercase tracking-[0.15em] text-paper/30">
              {taskCompleted ? "Verification complete" : "Awaiting approval"}
            </p>
          )}
        </div>

        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper/35">
              03 / Pinch
            </p>
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-cobalt">
              {payment?.status ?? "not sent"}
            </span>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-paper/50">
            Settlement atomically claims unpaid tasks once the balance reaches
            $10. One deterministic batch nonce prevents duplicate submissions.
          </p>
          {taskCompleted ? (
            <form action={settleAction} className="mt-7">
              <button
                className="inline-flex min-h-10 w-full items-center justify-center border border-cobalt bg-cobalt/10 px-4 py-2 text-sm text-paper transition-colors hover:bg-cobalt hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt disabled:cursor-wait disabled:opacity-60"
                disabled={isSettling}
                type="submit"
              >
                {isSettling ? "Settling balance…" : "Settle eligible balance"}
              </button>
            </form>
          ) : null}
          <div className="mt-7 border-t border-paper/10 pt-5">
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-paper/30">
              Pinch payment ID
            </p>
            <p className="mt-2 break-all font-mono text-[11px] text-paper/65">
              {payment?.providerPaymentId ?? "Created by settlement"}
            </p>
          </div>
        </div>
      </div>

      {actionState.message ? (
        <p
          className="border-t border-paper/15 px-6 py-4 text-sm leading-relaxed text-paper/65 sm:px-8"
          data-status={actionState.status ?? undefined}
          role={actionState.status === "error" ? "alert" : "status"}
        >
          {actionState.message}
        </p>
      ) : null}
    </div>
  );
};
