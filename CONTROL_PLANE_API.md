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
branch tip, commit, and tree; scans an exact-SHA ephemeral checkout without
running repository code; and returns a `binding.id`, `snapshot_id`, and
`manifest_hash`. Snapshot and binding records are immutable and user-owned.

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
semantically. Repository execution allowlisting is returned separately, so a
non-allowlisted repository can be assessed without becoming executable.
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
  repository/task allowlist also pass.
- `accept_with_conditions` is allowed only when its execution conditions are
  present in customer-visible pricing factors and quote terms. Those conditions
  are included in immutable pricing evidence and contract hashing.
- `decompose` and `decline` are persisted as rejected quotes and cannot be
  accepted. The database constraint and acceptance RPC enforce this
  independently of application eligibility.

The quote contract hash commits to binding ID, snapshot ID, manifest hash,
canonical repository/base identity, task, pricing evidence, policy version,
price, terms, and expiry. Execution remains fail-closed to the existing
allowlisted repository, SHA, task contract, and trusted verifier.

### Legacy fixture compatibility

The original `repository_url` plus `repository_sha` quote request remains
available as an isolated compatibility path for the pinned calculator fixture.
It retains the AUD 12.50 fixture regression. New integrations should use
`repository_binding_id`; binding-backed requests cannot also supply URL or SHA.

## Acceptance and status

1. `POST /api/v1/quotes/:quoteId/accept` atomically accepts the exact contract
   hash, copies immutable repository evidence to one task, starts one Cursor
   Cloud run, and returns `202`.
2. `GET /api/v1/tasks/:taskId` reconciles worker, verifier, and Pinch sandbox
   payment state.

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
- `OUTCOMES_GITHUB_TOKEN`
- Supabase variables from `.env.example`
- GitHub App variables from `.env.example`
- Pinch sandbox variables from `.env.example`

This Task 2 implementation has deterministic tests and an isolated local
Supabase Postgres 17 migration replay with transactional access/evidence
assertions. Its new migration is applied to production and the remote evidence
tables are queryable through the service-role Data API. The new REST surfaces
were not live-verified as part of this change.
