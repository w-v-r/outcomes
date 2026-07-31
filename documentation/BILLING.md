# Billing

This document is the source of truth for how Outcomes records verified work and
collects payment through Pinch.

## Customer promise

Outcomes does not charge when a quote is created, when a quote is approved, or
when a worker reports success.

A task becomes billable only after the trusted verifier confirms the approved
outcome. The exact approved quote amount is then added to the customer's
outstanding balance. Outcomes submits a Pinch payment when that balance reaches
AUD $10.

The charged amount is the full balance claimed for that settlement run, not a
fixed $10 increment:

- A single AUD $12.50 verified task produces an AUD $12.50 payment.
- Two verified tasks worth AUD $4 and AUD $6 produce one AUD $10 payment.
- An AUD $7 balance remains outstanding until later verified work brings the
  balance to at least AUD $10.

The current integration is locked to Pinch's test environment. It does not move
real money.

## Billing lifecycle

```text
quote approved
  → worker completes
  → trusted verifier passes
  → task quote accrues
  → task delivery is marked completed
  → scheduled settlement checks the customer balance
  → exact accrual rows are claimed
  → one Pinch payment is submitted for their sum
  → claimed tasks become paid
```

Task delivery and payment settlement are deliberately separate:

- `completed` means the work passed verification and was delivered.
- `unpaid`, `payment_in_progress`, and `paid` describe billing independently.
- A failed or delayed Pinch payment does not change a verified task into a
  failed delivery.

## Processes and schedules

Outcomes uses two independent Vercel cron processes.

### Task reconciliation

`/api/internal/task-executions/reconcile` runs every minute.

It progresses workers and verifiers. After successful verification it calls
`accrueVerifiedTask(taskId)`. This path records the accrual and completes the
task, but it never calls Pinch.

Local equivalent:

```bash
npm run tasks:reconcile -- --batch 1
```

### Billing settlement

`/api/internal/billing/settle` runs four times per day:

```text
00:00, 06:00, 12:00, and 18:00 UTC
```

It finds customers who either:

- have at least AUD $10 in outstanding accruals; or
- have an interrupted payment that requires same-nonce recovery.

It then calls `chargeOutstandingBalance(userId)` for each eligible customer.

Local/manual equivalent:

```bash
npm run billing:settle -- --batch 25
```

Both internal routes require `CRON_SECRET`. The number of customer balances
processed by a settlement run defaults to 25 and can be configured with
`OUTCOMES_BILLING_BATCH_SIZE`.

## Data model

### `billing_accruals`

One immutable billing obligation per verified task and approved quote.

Important fields:

- `task_id` and `quote_id`: uniquely identify the delivered work.
- `amount_cents` and `currency`: copied from the approved quote and protected
  from later changes.
- `payment_id`: the current batch payment, when claimed.
- `status`: the accrual state.

Accrual statuses:

| Status | Meaning |
| --- | --- |
| `accrued` | Verified and outstanding; not currently included in a payment |
| `charging` | Atomically claimed by a specific payment |
| `charged` | Covered by an approved, pending, or settled payment |
| `void` | Explicitly removed from collection |

### `payments`

One Pinch submission or recoverable submission attempt.

The amount, currency, payer, source, environment, and nonce are snapshotted
when the payment is reserved. Reservation evidence is immutable.

Batch payments have no direct `task_id` or `quote_id`. Their tasks are recorded
through allocations.

### `payment_allocations`

The audit link between a Pinch payment and each task included in its amount.

The sum of allocation amounts must correspond to the reserved payment amount.
An allocation is:

- `active` while it is the task's current payment allocation; or
- `released` when a failed attempt is retained for audit but the task may be
  claimed by a later payment.

Only one active allocation may exist for a task or quote.

## Atomic claiming and concurrent tasks

Settlement never charges a balance calculated in application memory. The
database function `claim_billing_accruals`:

1. locks the customer's outstanding accrual rows in a stable order;
2. returns without changes when their sum is below AUD $10;
3. creates one reserved payment for the exact locked sum;
4. creates allocations for exactly those rows; and
5. moves exactly those accruals to `charging`.

All five operations occur in one database transaction.

If another task accrues while a payment is being claimed, that new task is not
part of the payment amount. It remains `accrued` and is considered by a later
settlement run. This prevents a task from being marked paid when it was not
included in the provider charge.

Below-threshold customers are excluded before the settlement batch limit is
applied, so they cannot prevent newer eligible balances from being processed.

## Pinch submission and idempotency

Every batch receives a deterministic nonce:

```text
outcomes-batch-{paymentId}-charge-v1
```

Retries and ambiguous provider responses reuse that payment and nonce.

Additional duplicate protection includes:

- one accrual per task and quote;
- one active payment allocation per task and quote;
- immutable payment reservation evidence;
- provider payment ID uniqueness; and
- a short submission recovery delay that prevents overlapping cron requests
  from immediately resubmitting an in-flight payment.

Legacy per-task payment inserts are rejected. This prevents an old application
instance and the accrual settlement path from charging the same task with
different nonces during a rolling deployment.

## Payment outcomes and recovery

### Approved, pending, or settled

The payment is treated as successful and its claimed accruals become `charged`.
The customer console includes these amounts in Paid.

Successful payments cannot later regress to a failure state. This protects
against stale or out-of-order webhook events reopening already-paid tasks and
causing a duplicate charge.

### Definitive failure

A definitive provider rejection marks the payment failed. Its allocations are
retained as `released`, and only its own accruals return to `accrued`.

Those tasks remain completed but unpaid. A later settlement can reserve a new
payment for them.

### Unknown outcome

Transport errors and unrecognized or mismatched provider responses leave the
payment `unknown` and its accruals `charging`.

The next settlement run checks Pinch using the same nonce before attempting any
submission. It must not create a replacement nonce while the original outcome
is ambiguous.

## Customer console

The billing page reports:

- **Outstanding:** verified accruals currently waiting for settlement.
- **Processing:** accruals assigned to an in-flight or ambiguous payment.
- **Paid:** approved, pending, or settled payment batches.
- **Payment history:** each Pinch batch and the task titles allocated to it.

The tasks page reports billing separately from delivery:

- **Unpaid:** the task has an outstanding accrual.
- **Payment in progress:** the task belongs to an in-flight payment.
- **Paid:** the task has an active allocation in a successful payment.

The console never infers payment from `tasks.status = 'completed'`.

## Security

- Billing tables use row-level security so authenticated customers can read
  only their own records.
- Accrual, allocation, and payment writes are service-role only.
- Database functions are not executable by `public`, `anon`, or
  `authenticated`.
- Internal cron routes use constant-time `CRON_SECRET` authorization.
- Card details are collected by Pinch CaptureJS. Outcomes stores provider IDs
  and masked source details, never card numbers or CVC values.

## Relevant implementation

- `src/lib/billing/accrue-verified-task.ts`
- `src/lib/billing/charge-outstanding-balance.ts`
- `src/lib/billing/charge-verified-task.ts` (provider recovery helpers)
- `src/lib/billing/threshold.ts`
- `src/lib/control-plane/tasks.ts`
- `src/app/api/internal/billing/settle/route.ts`
- `src/app/api/webhooks/pinch/route.ts`
- `src/lib/console/data.ts`
- `supabase/migrations/20260731035108_billing_accrual_threshold.sql`
- `supabase/migrations/20260731041024_fix_accrue_verified_task_ambiguity.sql`
- `supabase/migrations/20260731041830_harden_accrual_settlement.sql`
- `supabase/migrations/20260731042334_lock_successful_payment_status.sql`
- `supabase/tests/billing_accruals.sql`

## Verification

The automated suite covers threshold policy, route authorization, cron
registration, atomic allocation structure, and provider nonce recovery. The
pgTAP specification covers:

- no claim below AUD $10;
- full-balance claiming at or above AUD $10;
- exact task-to-payment allocations;
- a task arriving after a claim remaining unpaid;
- successful payments charging only their own allocations;
- successful status regression protection; and
- failed payments releasing only their own tasks.

The production Supabase schema was migrated through
`20260731042334_lock_successful_payment_status.sql`.

The live Pinch sandbox proof approved payment `pmt_aHwTWeB3GD2Y7w` for AUD
$13.75. The matching task was completed, its accrual was charged, and exactly
one active allocation matched the task and amount.

## Known limitation

Pinch sandbox realtime-payment webhook delivery is tracked as PAY-001 in
`known-bugs-to-fix.md`. The realtime payment API and synchronous database
result are authoritative for the current sandbox proof. Same-nonce recovery
protects ambiguous submissions while webhook delivery remains unreliable.
