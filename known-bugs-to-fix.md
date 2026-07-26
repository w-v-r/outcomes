# Known bugs and loose ends

This document records reproducible defects, external integration problems, and
unfinished production work. Keep expected behavior, observed evidence,
attempted fixes, workarounds, and acceptance criteria together so an issue can
be resumed without repeating the investigation. Items explicitly marked as
loose ends are not claims that the current hackathon slice is broken.

## Resolved

### CTRL-001 — GitHub token cannot install the trusted verifier workflow

- **Status:** Resolved on 26 July 2026
- **First observed:** 26 July 2026
- **Area:** Control plane / trusted verification
- **Impact:** Cursor Cloud completes the allowlisted task and opens a correct
  pull request, but Outcomes fails closed before verification and payment.

#### Evidence

- Live task `2a8966ab-3542-4982-9ff2-a4a664f842b0` started Cursor agent
  `bc-e4b55d15-2aed-4450-9293-13668840e2cd`.
- Cursor opened
  `https://github.com/w-v-r/agent-cost-benchmark-fixture/pull/1`.
- The diff changes only `src/calculator.js` and implements the expected
  zero-divisor error.
- The GitHub CLI token has `repo` scope but not `workflow` scope.
- GitHub returned `404` when creating
  `.github/workflows/outcomes-verify.yml` through both the Contents API and Git
  Data API.
- `get_task_status` returned `verifier_dispatch_failed`; no payment was
  submitted.

#### Resolution performed

1. Granted the GitHub CLI token `workflow` scope.
2. Installed the fixed `outcomes-verify.yml` workflow on the fixture default
   branch and added task-specific run names in commit
   `4aff18a256039f727b54d3cc48b65e8e8eab7bb7`.
3. Repinned `FIXTURE_REPOSITORY.baselineSha` to that commit.
4. Changed verification to use each task's persisted repository SHA rather than
   the current registry SHA, preserving old quote contracts after repins.

#### Resolution criteria

- The workflow is present on the default branch.
- Task `2a8966ab-3542-4982-9ff2-a4a664f842b0` recorded successful GitHub
  Actions run `30193586555`.
- The task moved from `worker_succeeded` to `verified` and then `completed`.
- Exactly one Pinch sandbox payment, `pmt_K7uETwrp4p0J4X`, was recorded.
- Repeated status and acceptance requests reused the same payment and Cursor
  run.

## Open

### PAY-001 — Pinch sandbox does not deliver realtime-payment webhooks

- **Status:** Open; likely external provider or sandbox delivery issue
- **First observed:** 26 July 2026
- **Area:** Payments / Pinch webhooks
- **Environment:** Pinch test API and Vercel production
- **Impact:** Sandbox charges work and are recorded, but asynchronous
  reconciliation is not receiving provider-originated events.

#### Expected

Creating a Pinch realtime payment should generate a `realtime-payment` event and
cause Pinch to POST that event to:

`https://outcomes-chi.vercel.app/api/webhooks/pinch`

The route should verify the `pinch-signature`, insert the provider event into
Supabase, and reconcile the matching payment.

#### Actual

Pinch creates the payment and event, but no request reaches Vercel. The
`webhook_events` table therefore contains no Pinch-delivered event.

Two independent post-registration examples:

1. Payment `pmt_I04RUKEbplUWJd` was approved for AUD 13.75. Pinch created event
   `evt_1ObGag3JtNIJys`.
2. Payment `pmt_7PE4fdYbkGuIXt` was approved for AUD 13.75. Pinch created event
   `evt_yTaMNydVRMXGL1`.

#### Current configuration

- Vercel project: `w-v-r/outcomes`
- Production alias: `https://outcomes-chi.vercel.app`
- Webhook ID: `wbk_UdVUdjzVATrbWl`
- Callback: `https://outcomes-chi.vercel.app/api/webhooks/pinch`
- Subscription: `realtime-payment`
- Format: `camel-case`
- Pinch environment: `test`
- Pinch API version: `2020.1`

#### Evidence and checks completed

- The production application returns `200`.
- An unsigned webhook POST reaches the handler and returns `401`.
- A locally generated HMAC-SHA256 request using the Pinch-generated secret is
  accepted.
- The signed smoke test is persisted and marked processed in Supabase.
- Sending the same signed event twice returns the duplicate acknowledgement.
- Smoke-test fixtures are deleted after verification.
- Vercel logs contain the controlled signed and unsigned POST requests.
- Vercel logs contain no POST after either real sandbox payment.
- The Pinch Events API lists both expected `realtime-payment` events as
  `approved`.
- `GET /webhooks` returns the expected URI and `realtime-payment` subscription.
- All required Vercel production variables are present.
- The webhook secret is server-only and deployed as an encrypted Vercel
  variable.

#### Attempts already made

1. Registered the original public callback and deployed its generated secret.
2. Corrected the callback from the temporary Vercel project to `outcomes`.
3. Confirmed the exact callback is publicly reachable.
4. Confirmed signature verification, database persistence, and deduplication
   independently.
5. Deleted the webhook and created a fresh registration and secret.
6. Redeployed production with the rotated secret.
7. Ran another unique task and payment after the fresh registration.
8. Waited and rechecked Vercel logs, Supabase, and the Pinch Events API.

Do not repeat these steps without a new hypothesis.

#### Likely next actions

1. Ask Pinch support whether sandbox webhook delivery is enabled for this
   application and merchant.
2. Give support the webhook ID, payment IDs, event IDs, callback URL, and UTC
   timestamps from this issue.
3. Ask Pinch for webhook delivery-attempt logs, HTTP response details, queue
   status, and retry policy.
4. Check the Pinch Developer Portal for a disabled webhook, delivery status, or
   account-level setting not exposed by `GET /webhooks`.
5. If Pinch confirms delivery, compare their timestamp and request ID with
   Vercel logs.
6. Implement periodic Events API reconciliation so missed webhooks cannot leave
   payment state permanently stale.

#### Safe workaround

- Continue using the synchronous realtime-payment response to record immediate
  `approved` or failed status.
- Use the Pinch Events and Payments APIs to reconcile provider state.
- Keep the stable task-based nonce. Never retry an uncertain payment with a new
  nonce.
- Do not claim provider-originated webhook delivery in demonstrations until a
  real callback is observed.

#### Resolution criteria

This issue is resolved when all of the following are observed for one new,
uniquely identified sandbox task:

1. Pinch returns an approved realtime payment.
2. Pinch creates the corresponding `realtime-payment` event.
3. Vercel logs a Pinch-origin POST after the payment.
4. The signature is accepted without using a locally generated fixture.
5. Supabase records the provider event ID and payment ID.
6. The event is marked processed with no processing error.
7. A repeated delivery is acknowledged without a second charge or duplicate
   processing.

## Open loose ends

### CTRL-002 — Cursor model pricing and execution budget are not enforced

- **Status:** Open loose end; high-priority cost risk
- **Area:** Worker execution / underwriting
- **Nature:** The rate card specifies Composer 2.5 with `fast=false`, but the
  product worker currently passes only the model ID to Cursor. The persisted
  soft token, cost, tool-call, and wall-clock allowances are not supplied to or
  enforced by the asynchronous worker.
- **Evidence:** The completed production task returned no usage record or actual
  delivery cost, so the selected model variant and quote margin were not
  reconciled against provider billing.
- **Why it matters:** A fixed customer quote is only economically credible when
  Outcomes can select the priced model variant, observe actual cost, and stop or
  contain overruns.
- **Next action:** Pass versioned model parameters explicitly, retrieve
  authoritative Cursor usage/cost, enforce available run limits, and alert on
  missing or over-budget usage.
- **Done when:** A live run proves the expected model variant, persists usage
  and provider cost, and demonstrates a tested over-budget outcome.

### CTRL-003 — Task progress depends on customer status polling

- **Status:** Open architectural loose end; high priority
- **Area:** Control-plane orchestration
- **Nature:** `get_task_status` performs worker reconciliation, verifier
  dispatch/reconciliation, and verified-task charging. There is no independent
  scheduler, queue consumer, or provider callback advancing the task.
- **Why it matters:** If the customer stops polling, a finished worker can
  remain unreconciled and the verifier and payment stages may never run.
- **Next action:** Add a bounded scheduled reconciler or queue-backed worker
  that claims non-terminal tasks idempotently. Keep status reads safe but do not
  make them responsible for progress.
- **Done when:** An accepted task reaches a terminal state without any customer
  status request after acceptance.

### CTRL-004 — Verifier dispatch recovery needs stronger duplicate protection

- **Status:** Open loose end
- **Area:** GitHub Actions verification
- **Nature:** A workflow may be successfully dispatched but not discovered
  within the short run-ID lookup window. A later status request can dispatch
  another workflow because the first run ID was never persisted.
- **Why it matters:** Duplicate verification runs waste capacity and complicate
  evidence selection even though they cannot create a duplicate payment.
- **Next action:** Persist a dispatch attempt identifier before calling GitHub,
  search by task ID before every dispatch, widen asynchronous discovery, and add
  a duplicate-dispatch test.
- **Done when:** Delayed GitHub run visibility still resolves to exactly one
  trusted verifier run.

### SEC-001 — Public usage has no rate, concurrency, or spend controls

- **Status:** Open loose end; required before broad public access
- **Area:** Abuse prevention / cost control
- **Nature:** A customer with a ready sandbox billing account and API key can
  submit repeated eligible tasks. Authentication and idempotency exist, but
  per-customer rate limits, concurrent-run limits, daily spend limits, and an
  operator kill switch do not.
- **Why it matters:** Pinch is in sandbox mode while Cursor usage can incur a
  real cost to the single Outcomes-owned account.
- **Next action:** Add API throttling, one-active-task limits, account and global
  budgets, anomalous-usage alerts, and an emergency execution disable flag.
- **Done when:** Automated tests prove excess requests fail safely before a
  worker is launched.

### SEC-002 — Provider credentials are hackathon-grade

- **Status:** Accepted hackathon constraint; open before production
- **Area:** GitHub / Cursor credentials
- **Nature:** All work uses one Outcomes-owned Cursor account, and verification
  uses a GitHub token with repository and workflow access.
- **Why it matters:** Personal or broadly scoped credentials increase blast
  radius and make rotation, attribution, and tenant isolation difficult.
- **Next action:** Move to dedicated service identities, a least-privilege
  GitHub App or fine-grained token, documented rotation, and auditable secret
  ownership.
- **Done when:** No personal credential is required by production and each
  provider permission is limited to the operation Outcomes performs.

### SEC-003 — Supabase leaked-password protection is disabled

- **Status:** Open project configuration loose end
- **Area:** Authentication
- **Evidence:** The Supabase security advisor reports this as the remaining
  project-level warning.
- **Next action:** Enable leaked-password protection in the Supabase Auth
  dashboard and verify signup/sign-in behavior.
- **Done when:** The security advisor is clear and a compromised-password test
  is rejected as expected.

### TEST-001 — Destructive and isolation paths need automated coverage

- **Status:** Open testing loose end; high priority
- **Area:** Control plane / database / payments
- **Missing coverage:** Rejected Pinch payments, unknown payment outcomes,
  worker and verifier timeouts, simultaneous acceptance, concurrent status
  polling, duplicate worker and verifier starts, stale-start recovery,
  cross-user quote/task/API-key access, and direct RLS isolation.
- **Why it matters:** The successful path and basic replay behavior are proven,
  but these are the cases most likely to expose duplicate execution, data
  leakage, or an invalid charge.
- **Done when:** Repeatable integration tests exercise each path against a test
  database and fake providers, with selected sandbox contract tests.

### AUTH-001 — The full authentication lifecycle lacks one continuous trace

- **Status:** Open verification loose end
- **Area:** Supabase Auth
- **Missing evidence:** Signup through email-confirmation callback in one
  controlled session, authenticated sign-out, and confirmation that the
  protected dashboard redirects to sign-in after sign-out.
- **Done when:** One browser test captures the complete lifecycle without
  manual state carried from another browser.

### MCP-001 — Non-Cursor MCP compatibility is documented but not proven

- **Status:** Open compatibility loose end
- **Area:** MCP distribution
- **Nature:** The hosted Streamable HTTP endpoint and bearer authentication were
  tested directly and in Cursor. The README now documents generic MCP clients
  and custom harnesses, but no second MCP host or official SDK client has
  completed the lifecycle.
- **Next action:** Smoke-test initialization, tool discovery, quoting, approval,
  and status polling from at least one non-Cursor desktop client and one small
  SDK harness.
- **Done when:** Client-specific setup notes name the tested products and
  versions, and both use the same customer API key safely.

### UI-001 — The console does not expose API-created task history

- **Status:** Open product loose end
- **Area:** Outcomes Console
- **Nature:** The dashboard supports sandbox billing, its local demonstration,
  and API-key management. It does not provide dedicated quote/task history,
  event timelines, worker output, verifier evidence, payment detail, or margin
  views for work created through MCP or REST.
- **Why it matters:** Customers currently need their agent or API response to
  retain task IDs and inspect delivery evidence.
- **Next action:** Add owned quote and task lists plus task-detail views backed
  by the existing control-plane records.
- **Done when:** A customer can find an MCP-created task in the console and
  inspect its complete contract, output, verification, and payment timeline.

### PRICE-001 — Pricing remains a single-fixture heuristic

- **Status:** Accepted MVP constraint; open research and product work
- **Area:** Pricing / underwriting
- **Nature:** The current AUD 12.50 quote uses a deterministic heuristic, fixed
  exchange rate, fixed risk multiplier, and one model rate. It is not calibrated
  from a statistically meaningful execution history and does not yet model
  verification cost, payment fees, remediation, or target margin explicitly.
- **Next action:** Capture authoritative usage and outcomes, version rate cards
  and policy inputs, build a labelled evaluation corpus, and compare predicted
  distributions with actual delivery cost.
- **Done when:** Backtests establish documented calibration and margin targets
  across multiple bounded task families.

### SCOPE-001 — Only one repository, SHA, and task contract are eligible

- **Status:** Intentional hackathon boundary; not a bug
- **Area:** Product eligibility
- **Nature:** Outcomes rejects all work except the pinned public calculator
  fixture and exact zero-division contract.
- **Next action:** Before widening scope, implement GitHub customer onboarding,
  immutable repository snapshots, a semantic contractability classifier, and
  safe server-owned verifier profiles or a real verifier sandbox.
- **Safety rule:** Never expose customer-supplied shell commands as verifier
  input, and never let semantic classification loosen deterministic hard gates.
- **Done when:** Additional task families pass a positive, negative, ambiguous,
  and prompt-injection regression corpus with trusted independent verification.

### LIFE-001 — Cancellation, remediation, and delivery policy are undefined

- **Status:** Open product decision
- **Area:** Customer lifecycle
- **Nature:** Once a quote is accepted there is no customer cancellation,
  retry/rework, review-window, dispute, or remediation operation. A task is
  considered delivered when a verified branch or pull request exists; Outcomes
  does not merge it.
- **Next action:** Define terminal-state semantics, who merges work, cancellation
  cutoffs, failed-verification remediation, and whether a review window exists
  before payment.
- **Done when:** The API, task states, terms, and console all implement the same
  documented policy.

### PAY-002 — Live-money operations are not designed

- **Status:** Intentional sandbox boundary; blocker for live payments
- **Area:** Payments / operations / compliance
- **Missing work:** Live credential separation, production payment-source
  onboarding, failed-payment recovery, refunds, disputes, settlement
  reconciliation, customer receipts, support procedures, data retention, PCI
  scope review, and legal/commercial terms.
- **Safety rule:** Keep `PINCH_ENVIRONMENT=test` hard-locked until this item and
  PAY-001 are resolved.
- **Done when:** Pinch and Outcomes operational procedures have been reviewed,
  tested in an approved environment, and explicitly authorized for real funds.

### OPS-001 — Background reconciliation, monitoring, and alerting are absent

- **Status:** Open operational loose end
- **Area:** Reliability
- **Missing work:** Scheduled Pinch Events or Payments API reconciliation,
  stuck-task detection, worker/verifier/provider latency metrics, failure-rate
  dashboards, webhook-delivery alerts, payment mismatch alerts, and runbooks.
- **Next action:** Define service-level thresholds and add structured telemetry
  plus alerts before relying on the service outside a supervised demo.
- **Done when:** A deliberately missed webhook and a deliberately stuck task are
  detected and reconciled without manual database inspection.

### DIST-001 — Distribution still uses a Vercel alias and manual MCP setup

- **Status:** Open go-to-market loose end; low priority for the hackathon
- **Area:** Product distribution
- **Nature:** Customers configure the Vercel production alias manually. There is
  no custom Outcomes domain, one-click MCP installation, marketplace listing,
  compatibility matrix, public status page, or API changelog.
- **Done when:** The production endpoint has a stable owned domain and supported
  clients have a tested, versioned installation path.

### DOC-001 — Historical planning documents contain stale current-state text

- **Status:** Open documentation loose end
- **Area:** Repository documentation
- **Examples:** The early “current repository state” section of
  `OUTCOMES_IMPLEMENTATION_PLAN.md` still says authentication and control-plane
  dependencies do not exist; the prototype handoff correctly describes the
  spike at handoff time but can be mistaken for current product status; and
  `CONTROL_PLANE_API.md` calls the public fixture private.
- **Next action:** Mark historical snapshots explicitly and align current-state
  summaries with the completed vertical slice without deleting useful research
  history.
- **Done when:** A new contributor can distinguish current behavior, historical
  context, intentional constraints, and future work without cross-referencing
  chat history.
