# Outcomes control-plane API

REST and the application kernel are authoritative for repository evidence,
assessment, pricing, eligibility, acceptance, and execution. Clients must not
calculate prices locally or execute customer repository commands at quote time.

## Authentication

Create a key in the authenticated Outcomes dashboard. The complete value is
shown once and stored only as a SHA-256 hash. Send it to REST and MCP as:

```text
Authorization: Bearer outcomes_test_<prefix>_<secret>
```

The API derives ownership only from this authenticated principal. Request
bodies never accept a user ID.

## Repository discovery and immutable preflight

`GET /api/v1/repositories/installations` lists the caller's active GitHub App
installation generations. The response contains customer-safe account,
selection, suspension, and generation metadata; it never contains an
installation token, app private key, or other secret.

`POST /api/v1/repository-bindings` verifies access and captures an exact
repository snapshot:

```json
{
  "stored_installation_id": "22222222-2222-4222-8222-222222222222",
  "repository_url": "https://github.com/owner/repository",
  "base_branch": "main",
  "base_sha": "0123456789abcdef0123456789abcdef01234567"
}
```

The service verifies the current GitHub installation, canonical repository ID,
branch tip, commit, and tree; streams and scans a bounded exact-SHA GitHub
archive without running repository code; and returns a `binding.id`,
`snapshot_id`, and `manifest_hash`. Snapshot and binding records are immutable
and user-owned.

## Non-binding assessment

`POST /api/v1/assessments` creates or replays a planning assessment:

```json
{
  "idempotency_key": "assessment-request-001",
  "repository_binding_id": "33333333-3333-4333-8333-333333333333",
  "task": {
    "description": "Implement bounded retry handling in src/payment.ts.",
    "acceptanceCriteria": ["The retry state is persisted.", "Tests pass."],
    "prohibitedChanges": ["Do not change authentication."]
  },
  "source": {
    "provider": "linear",
    "content_sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "workspace_id": "workspace-1",
    "team_id": "team-1",
    "project_id": "project-1",
    "issue_id": "WIL-42",
    "issue_url": "https://linear.app/example/issue/WIL-42/example"
  }
}
```

The response contains a non-binding AUD range, decision, confidence, policy
version, customer-safe factors, repository/snapshot/manifest identity, and a
`pricing_evidence_hash`. For Linear input, the caller must normalize the issue
content and provide its SHA-256 as `content_sha256`; Outcomes persists and
fingerprints that exact hash rather than fabricating content identity from
issue IDs or task fields. An assessment always returns
`"accepted": false`; it cannot be accepted or start work. Unsafe,
contradictory, and unverifiable external-business-outcome requests decline
semantically. Execution eligibility is returned separately from the planning
decision and requires a canonical immutable GitHub binding.
Assessment rows contain internal analysis and underwriting and therefore have
no authenticated Data API grant or policy. The authenticated REST application
service is the only customer assessment surface; table RLS remains enabled as
defense in depth.

## Snapshot-backed quote

`POST /api/v1/quotes` uses `repository_binding_id` as the authoritative
repository input:

```json
{
  "idempotency_key": "quote-request-001",
  "repository_binding_id": "33333333-3333-4333-8333-333333333333",
  "task": {
    "description": "Fix src/calculator.js so divide throws an Error when the divisor is zero.",
    "acceptanceCriteria": [
      "The existing zero-divisor test passes.",
      "Existing add and non-zero divide behavior remains unchanged."
    ],
    "prohibitedChanges": [
      "Do not modify tests.",
      "Do not add dependencies.",
      "Do not change the exported function names."
    ]
  }
}
```

The service loads the caller-owned binding and immutable snapshot together,
validates every ID, SHA, URL, and manifest hash, then analyzes the persisted
`snapshot.manifest`. Callers cannot override repository URL or SHA in this
contract. The fixed price uses a versioned, uncalibrated variable policy and
includes internal coverage for predicted worker high cost, quote analysis,
verification, retry/risk, payment, margin, and a commercial minimum.
Customer responses expose only safe range/confidence/factor evidence.
The quote response also returns `pricing_evidence_hash`, the non-recursive hash
committed into `contract_hash`, so customers can reproduce the visible
contract.

Snapshot quote and underwriting insertion is one service-role-only,
`SECURITY INVOKER` transaction. Advisory-lock idempotency returns an explicit
created/replayed result, and no pending quote can commit without its matching
underwriting evidence.

Estimator decision is an execution gate:

- `accept` may become a pending executable quote when semantic safety and the
  immutable repository binding also passes.
- `accept_with_conditions` is allowed only when its execution conditions are
  present in customer-visible pricing factors and quote terms. Those conditions
  are included in immutable pricing evidence and contract hashing.
- `decompose` and `decline` are persisted as rejected quotes and cannot be
  accepted. The database constraint and acceptance RPC enforce this
  independently of application eligibility.

The quote contract hash commits to binding ID, snapshot ID, manifest hash,
canonical repository/base identity, task, pricing evidence, policy version,
price, terms, and expiry. Equivalent UTC expiry encodings are normalized before
hashing so the persisted Postgres timestamp reproduces the presented contract.
Execution remains fail-closed to immutable repository and safety evidence.

### Legacy fixture compatibility

The original `repository_url` plus `repository_sha` quote request remains
available as an isolated compatibility path for the pinned calculator fixture.
It retains the AUD 12.50 fixture regression. New integrations should use
`repository_binding_id`; binding-backed requests cannot also supply URL or SHA.

## Acceptance and status

1. `POST /api/v1/quotes/:quoteId/accept` atomically accepts the exact contract
   hash, copies immutable repository evidence to one task, and returns `202`.
   Replays return that same task and never launch work inline.
2. The authenticated internal reconciler atomically leases accepted tasks,
   executes the isolated Cursor worker at the exact SHA, publishes one
   deterministic draft PR, then advances trusted verification and payment.
3. `GET /api/v1/tasks/:taskId` is read-only. It returns persisted execution,
   branch/PR, verifier, payment, failure, and timeline state; polling is never
   required for progress.

The execution RPC uses one durable `task_execution_attempts` record per task,
a rotating claim token, and an expiring lease. Concurrent reconcilers cannot
hold the same task. Each invocation claims at most one isolated task. Its
90-second lease is renewed every 20 seconds; an expired or replaced token cannot
renew, fail, publish, or complete the attempt. Loss aborts the child worker and
leaves the task recoverable. Temporary infrastructure/provider errors retain
prepublication evidence and defer for bounded 30/60-second backoff; the third
failure becomes terminal. Expired active leases can be recovered; terminal
attempts and terminal tasks are not reclaimed.

Claims require snapshot evidence, `cursor` + `isolated_local`, and either no
run evidence or run evidence matching the durable attempt. Existing Cursor
Cloud/legacy starts cannot be overwritten. Legacy accepted tasks continue
through the prior cloud lifecycle in the background. Cursor run IDs and
validated changes are persisted before publication. If publication committed
before local persistence was observed, retry derives the same mode-sensitive
branch/commit identity and queries open, closed, and merged PRs before creating
anything. Open PRs are reused, closed-unmerged PRs must be reopened, merged PRs
are recorded as delivered, and multiple exact matches fail closed. If the base
branch moved, only an already-existing exact PR whose commit has the accepted
parent and file scope can recover; no new stale-base work is created.

Before execution, the service compares the accepted task, quote, underwriting,
binding, snapshot, manifest hash, repository ID, installation generation,
branch, SHA, task contract, estimator evidence, and reproducible contract hash.
It then rechecks current GitHub App permissions, repository identity, exact
branch tip, and commit. Revoked, stale, or mismatched evidence fails closed with
a customer-safe error; detailed evidence remains on the service-only attempt.

Acceptance independently requires matching immutable underwriting evidence.
An expired pending quote is durably transitioned to `expired` and returned as a
conflict; the transition is not rolled back by a raised database exception.

Acceptance request:

```json
{
  "contract_hash": "<hash returned by the quote>",
  "idempotency_key": "customer-acceptance-001"
}
```

Never change an idempotency key's request body. Exact reuse returns the original
resource; changed task, source, or binding identity returns `409`.

Snapshot execution accepts estimator-approved, safety-checked tasks against
immutable bindings. Allowed paths come from persisted underwriting analysis
intersected with the immutable manifest; test, manifest, generated, binary, and
unsupported file shapes are excluded.

Verifier dispatch persists a timestamp and recovery lease; the task ID is the
provider-visible workflow identity. Dispatch and recovery are scoped to the
task repository and base branch; a repository without the trusted
`outcomes-verify.yml` profile cannot verify or charge. A crash with no stored
run ID searches GitHub Actions for that identity; multiple or undiscoverable
runs fail closed without redispatch or charging. Pinch
`reserved`, `submitting`, and ambiguous states first query the deterministic
provider nonce and may resubmit only with that same nonce after no replay is
observed. Each reservation snapshots payer/source IDs, amount, and currency.
Payment insertion and mutation are service-only, and a database trigger makes
that reservation payload immutable.
Conditional payment/task updates cannot replace approved/pending/completed
state with a late ambiguous result. Only Pinch `400`/`422` semantic rejection
responses are terminal; `401`, `403`, `404`, `409`, `429`, transport, and `5xx`
outcomes remain recoverable. Charging still begins only from independently
verified tasks.

Task status uses the shared `customerTaskExecutionSchema`. It exposes
customer-safe attempt state, claim/failure counts, retry time, and safe failure
reason; internal errors remain service-only. Projection query failures return a
control-plane error rather than silently omitting evidence. Cron returns HTTP
`207` with `partial: true` when any downstream lifecycle reconciliation fails.

The internal route is a bounded hackathon runner, not a general sandbox. The
worker child is capped at eight minutes inside the route's 800-second duration.
Vercel tracing includes the TypeScript worker, direct `cursor-run.ts` source,
Cursor SDK, and `tsx`, but deployment still requires `git`, child processes,
writable temporary storage, and suitable memory. The local/external
`tasks:reconcile -- --batch 1` command is the fallback.
Cursor token usage is retained; authoritative provider cost is not exposed by
the current local result, so `actual_cost_usd_micros` remains `null`. The local
workspace itself is ephemeral: only validated change/run evidence survives a
process crash, not a resumable checkout or in-flight Cursor process.

## Cursor MCP

The MCP currently exposes `quote_task`, `accept_quote_and_start`, and
`get_task_status`. It is a thin adapter over the same quote, acceptance, and
task services. Repository discovery/preflight and assessments are currently
REST-only. MCP advertises only the required binding-backed quote schema; the
legacy URL/SHA fixture shape is REST compatibility only. No future CLI should
contain a local pricing implementation.

## Outcomes CLI

The `@outcomes/cli` workspace package (binary `outcomes`) is a thin REST adapter
over the endpoints above. It performs local Git discovery and explicit approval
UX only; repository capture, assessment, pricing, acceptance, execution, and
status reconciliation remain on the server. Use `OUTCOMES_API_KEY` and optional
`OUTCOMES_API_BASE_URL`. The package is built from this monorepo and is **not**
claimed as a published npm release in Task 3.

## Server environment

- `CURSOR_API_KEY`
- `OUTCOMES_CURSOR_MODEL`
- `CRON_SECRET`
- `OUTCOMES_EXECUTION_BATCH_SIZE` (optional; use `1`; isolated claims are
  always one per invocation)
- `OUTCOMES_GITHUB_TOKEN`
- Supabase variables from `.env.example`
- GitHub App variables from `.env.example`
- Pinch sandbox variables from `.env.example`

Task 4 adds `20260730163203_task_execution_claims.sql`, authenticated
`GET|POST /api/internal/task-executions/reconcile`, a one-minute Vercel cron,
and `npm run tasks:reconcile -- --batch 1`. The migration was replayed from zero
on ephemeral Postgres 17.10 with transactional claim, stale-fence,
retry-backoff, cloud-exclusion, payment-evidence, RLS, and grant assertions in
`supabase/tests/task_execution_claims.sql`, then applied to the linked
production project. Remote history and service-role Data API access to the new
execution, task, and payment fields were verified.

Rolling deploy order: deploy the application first, promptly apply the Task 4
migration, then enable cron. The migration converts approved binding-backed
tasks with no agent/run to `isolated_local`. New code continues cloud tasks
already in `starting`/`executing`, including binding-backed tasks created by an
old instance during the rolling window, but never newly starts an approved
binding-backed task on Cloud.

This Task 2 implementation has deterministic tests and an isolated local
Supabase Postgres 17 migration replay with transactional access/evidence
assertions. Its new migration is applied to production and the remote evidence
tables are queryable through the service-role Data API. Repository capture,
snapshot quote, acceptance, task status, deterministic PR publication, and
no-charge verification failure were subsequently live-verified against
`outcomes-test-org/real-work`.
