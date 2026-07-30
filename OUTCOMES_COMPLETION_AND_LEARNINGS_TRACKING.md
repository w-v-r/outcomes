# Outcomes completion and learnings

This document records completed implementation work, directly observed
verification, and lessons that should carry into later phases.

## 26 July 2026 — Phase 1: Authentication and console shell

Status: **implementation complete; core real-account flow verified**.

### Implemented

- Added the current `@supabase/ssr` and `@supabase/supabase-js` packages.
- Added request-scoped browser and server Supabase clients.
- Added Next.js 16 `proxy.ts` session refresh for authentication and console
routes.
- Added server-verified authorization with `supabase.auth.getClaims()`.
- Added email-and-password account creation and sign-in.
- Added the PKCE callback route with safe relative redirects.
- Added authenticated sign-out.
- Added the `/sign-in` route.
- Added the protected `/dashboard` Outcomes Console.
- Added the Sign in link to the existing landing-page header.
- Kept the landing page otherwise visually and structurally unchanged.
- Added `.env.example` with placeholder values only.
- Updated the durable implementation plan with the Phase 1 architecture.



### Design delivered

- The public landing page retains its light editorial design.
- Sign-in and console surfaces use a darker control-plane treatment.
- The console reuses the existing typography, cobalt accent, square geometry,
fine rules, and ledger language.
- The authenticated shell currently exposes only working navigation rather than
placeholder destinations.



### Automated and browser verification

- ESLint passes.
- The production build passes.
- `/` remains statically rendered.
- The landing page was visually checked at desktop and mobile sizes.
- An unauthenticated `/dashboard` request redirects to `/sign-in`.
- Invalid credentials produce a clear accessible error.
- The configured Supabase project responds successfully to authentication
requests.



### Real-account verification

- Created a real customer account.
- Confirmed that signup triggered a Supabase confirmation email.
- Successfully submitted the email-and-password sign-in form.
- Observed `POST /sign-in` return `303` and redirect to `/dashboard`.
- Confirmed that the authenticated dashboard rendered with an active Supabase
session and private-session state.
- Confirmed that no JavaScript or authentication errors occurred during the
successful sign-in.



### Evidence limits and remaining checks

- Signup and email receipt occurred in a different browser from the controlled
sign-in test, so the signup request and confirmation callback were not captured
as one continuous trace.
- The confirmation-link callback and redirect allow-list behavior were not
directly observed in the controlled browser.
- Authenticated sign-out still needs a real-session smoke test.
- After sign-out, `/dashboard` should be reopened to confirm that it redirects to
`/sign-in`.

These remaining checks do not invalidate the verified signup, sign-in, session,
redirect, and protected-dashboard flow.

### Development warnings observed

1. Next.js detected global `scroll-behavior: smooth` without
  `data-scroll-behavior="smooth"` on the root `<html>` element.
2. Instrument Sans and the normal Newsreader variant triggered Chrome preload
  timing warnings during development.

The warnings did not affect authentication. Address the scroll warning together
with reduced-motion behavior. Treat the font warnings as low priority and verify
them against a production deployment before changing preload behavior.

### Learnings for later phases

- Keep signup, email confirmation, sign-in, dashboard access, and sign-out in one
controlled browser when collecting complete end-to-end evidence.
- A received confirmation email proves that delivery was initiated; it does not
independently prove callback-route or redirect-allow-list behavior.
- Server-action response, session establishment, protected redirect, and
authenticated rendering provide the strongest evidence from this test.
- Keep authorization checks in protected server boundaries even when Proxy
performs optimistic session refresh.
- Separate browser warnings from flow-breaking errors.
- Preserve the landing-page regression check whenever shared layout, typography,
or global styles change.

## 26 July 2026 — Phase 2: Pinch sandbox payments

Status: **sandbox charging proven; provider webhook delivery remains open**.

### Implemented

- Added Supabase tables for profiles, billing accounts, payment sources, tasks,
  quotes, payments, and webhook events.
- Added ownership-based RLS policies, foreign keys, status constraints,
  uniqueness constraints, and immutable approved-quote protection.
- Added a server-only Pinch client with OAuth client-credentials authentication,
  token caching, request timeouts, structured errors, and a hard test-mode
  guard.
- Added Pinch Payer creation and CaptureJS payment-source tokenisation during
  billing onboarding.
- Redirected newly registered users through `/billing/setup` before dashboard
  access.
- Added an explicit task lifecycle: quote, customer approval, execution,
  verification, completion, and payment.
- Added realtime Pinch card charging using the approved quote amount supplied by
  the pricing boundary.
- Added database uniqueness and Pinch nonce checks to prevent duplicate charges
  and safely recover from interrupted payment responses.
- Added a signed webhook route at `/api/webhooks/pinch` with HMAC-SHA256
  verification, timestamp tolerance, constant-time signature comparison, event
  deduplication, and payment-status reconciliation.
- Added a server-only Supabase admin client for webhook processing.
- Added repeatable scripts to configure the Pinch webhook, test signature and
  deduplication behavior, and simulate mocked pricing plus MCP-style worker
  completion.
- Deployed the payment-enabled app to the intended Vercel `outcomes` project at
  `https://outcomes-chi.vercel.app`.
- Configured all nine required production environment variables in Vercel.
- Registered the production callback with Pinch for `realtime-payment` events.

### Payment verification

- Successfully created a Pinch sandbox Payer and vaulted test card source.
- Successfully charged the dashboard demonstration quote for AUD 12.50.
- Successfully ran the mocked pricing and worker harness twice at AUD 13.75.
- The latest mock task `d5d1f44f-d899-4301-a8b8-ed54d1ca063d` moved through
  verified to completed.
- Pinch payment `pmt_7PE4fdYbkGuIXt` returned `approved`.
- Supabase persisted the matching task, quote, amount, nonce, Pinch payment ID,
  charge timestamp, and approved status.
- Pinch independently recorded event `evt_yTaMNydVRMXGL1` with type
  `realtime-payment`, status `approved`, and amount `1375`.
- Reusing a task cannot create a second payment because task, quote, nonce, and
  provider payment identifiers are uniquely constrained.

### Webhook verification

- The public Outcomes application returns `200`.
- An unsigned request to the webhook route returns `401`.
- A correctly signed fixture is accepted, persisted, processed, and removed
  after the smoke test.
- Re-delivery of the same signed fixture is detected as a duplicate and
  acknowledged without reprocessing.
- The Pinch webhook was moved from the temporary Vercel project to
  `https://outcomes-chi.vercel.app/api/webhooks/pinch`.
- The webhook was then deleted and freshly recreated as
  `wbk_UdVUdjzVATrbWl`, with a rotated secret deployed to Vercel.
- Despite two successful post-registration sandbox payments, Pinch made no HTTP
  request to the callback. Vercel request logs contain only our controlled smoke
  tests, and Supabase contains no Pinch-delivered webhook event.

The unresolved delivery issue is tracked as `PAY-001` in
`known-bugs-to-fix.md`.

### Fixes made during implementation

- Wrapped the post-CaptureJS Server Action dispatch in a React transition,
  resolving the `useActionState` outside-a-transition error.
- Added the required `data-scroll-behavior="smooth"` root attribute for Next.js
  route-transition behavior.
- Excluded Supabase CLI state and local environment files from source control
  and Vercel deployment uploads.
- Corrected the initial Vercel project mismatch by relinking the repository from
  the temporary `llm-bto-customer-app` project to `outcomes`.

### Automated and deployment verification

- ESLint passes.
- TypeScript and the production Next.js build pass locally and on Vercel.
- The production webhook route is present and executes in the Node.js runtime.
- Webhook signature, persistence, processing, cleanup, and duplicate-delivery
  tests pass against production.
- The Pinch authentication, Payer, Source, realtime payment, nonce, webhook, and
  Events API contracts were exercised in test mode.

### Learnings for later phases

- A successful payment API response proves that Pinch accepted the charge; it
  does not prove that an asynchronous webhook was delivered.
- A Pinch webhook URL is supplied by our deployment. Its `whsec_...` secret is
  generated when the webhook is created, rather than copied from the developer
  account beforehand.
- Payment submission must be idempotent before any worker can call it. Database
  reservation and a stable provider nonce are complementary protections.
- Store provider identifiers beside internal task, quote, source, and payment
  identifiers so either system can be reconciled independently.
- Preserve the raw request body until after webhook signature verification.
- Treat webhook handlers as retryable consumers: authenticate, deduplicate,
  persist receipt, process, and acknowledge.
- Provider event creation and provider webhook delivery are separate observable
  systems. The Events API can prove event creation when delivery is missing.
- Production payment reliability should not depend on webhooks alone. Add
  periodic Events API or payment-status reconciliation for missed deliveries.
- The mock worker harness proves the integration boundary, but the application
  still needs a reusable `chargeVerifiedTask(taskId)` service shared by the
  dashboard and future MCP server.

### Remaining payment work

- Resolve `PAY-001` with Pinch and capture one genuine Pinch-origin webhook.
- Add periodic reconciliation through the Pinch Events or Payments API.
- Add automated rejected-payment, timeout, concurrent-completion, duplicate
  execution, and cross-user RLS tests.
- Define live-mode compliance, operational alerting, refund, and settlement
  procedures before enabling real funds.

## 26 July 2026 — Phase 3: MCP and worker vertical slice

Status: **complete live sandbox vertical slice verified**.

### Implemented

- Added customer API keys with one-time display, SHA-256-only storage, prefix
  lookup, constant-time verification, last-used tracking, and revocation.
- Added strict bearer authentication shared by REST and MCP.
- Ported the deterministic pricing kernel into server-only product modules.
- Added a fail-closed policy for the exact calculator fixture repository, pinned
  SHA, and zero-division contract.
- Added explicit rejection for changed SHAs, unknown task shapes,
  contradictory outcomes, and revenue guarantees.
- Added immutable AUD quotes with an AUD 12.50 floor, expiry, canonical contract
  hash, private underwriting records, and request idempotency.
- Added atomic quote acceptance through a service-role-only Postgres RPC.
- Added asynchronous Cursor Cloud launch with persisted agent/run identifiers,
  provider-neutral worker interfaces, bounded prompts, and status reattachment.
- Added append-only task events and precise worker, verifier, payment, and
  failure states.
- Added a GitHub Actions verifier adapter that can dispatch only the fixed
  `outcomes-verify.yml` workflow and never accepts customer commands.
- Extracted `chargeVerifiedTask(taskId)` and made both dashboard and control
  plane use the same deterministic Pinch nonce and one-payment-per-task guard.
- Added canonical REST operations:
  - `POST /api/v1/quotes`
  - `POST /api/v1/quotes/:quoteId/accept`
  - `GET /api/v1/tasks/:taskId`
- Added authenticated Streamable HTTP MCP at `/api/mcp` with exactly
  `quote_task`, `accept_quote_and_start`, and `get_task_status`.
- Applied and linted the control-plane migrations in the linked Supabase
  project.

### Directly observed verification

- Nine unit tests pass across API-key, pricing, eligibility, quote, and worker
  prompt boundaries.
- ESLint, TypeScript, and the Next.js production build pass.
- Supabase migration history is aligned and `db lint` reports no schema errors.
- Supabase security advisors were reduced to the project-level leaked-password
  protection setting; the exposed `rls_auto_enable()` execution grants were
  revoked.
- The authenticated dashboard created and revoked a real customer API key.
- Missing bearer credentials return `401` for REST and MCP.
- An eligible quote returned `201`, AUD 12.50, a 64-character contract hash,
  and the pinned repository identity.
- Repeating the request returned the same quote with `replayed: true`.
- A contradictory task returned `422`, was recorded as rejected, and created no
  worker.
- MCP initialization and `tools/list` returned the exact three intended tools.
- Accepting the quote returned `202` with task, Cursor agent, and run IDs.
- Cursor Cloud created pull request
  `w-v-r/agent-cost-benchmark-fixture#1`, changing only
  `src/calculator.js` with the expected zero-division fix.
- Installed the fixed trusted workflow after granting the required GitHub
  `workflow` OAuth scope.
- GitHub Actions run `30193586555` verified the exact Cursor result branch and
  concluded `success`.
- The task moved through `worker_succeeded`, `verifying`, `verified`,
  `charging`, and `completed`.
- Pinch sandbox payment `pmt_K7uETwrp4p0J4X` charged the exact AUD 12.50 quote
  and returned `approved`.
- Repeating task status preserved the same payment ID with one payment event.
- Repeating quote acceptance reused the same task, Cursor agent, and run.
- Both temporary smoke-test API keys were revoked after verification.

### Resolved implementation blocker

GitHub initially returned `404` for workflow-file writes because the GitHub CLI
OAuth token had `repo` but not `workflow` scope. After explicit authorization,
the workflow was installed and given a task-specific run name so dispatch can
reliably discover its run ID. The fixture is now pinned to
`4aff18a256039f727b54d3cc48b65e8e8eab7bb7`. Each task still verifies against
its own persisted repository SHA, so later registry repins cannot alter an
already accepted contract.

### Learnings

- A successful Cursor run and a correct pull request are delivery evidence, not
  authorization to charge.
- A strict repository/task registry can safely prove the product loop before a
  semantic classifier exists.
- REST and MCP must call the same services; otherwise idempotency, ownership,
  and payment rules drift.
- Dashboard demo controls must be isolated from API-created tasks so a manual
  demo action cannot bypass trusted verification.
- GitHub workflow-file writes require a distinct OAuth `workflow` scope even
  when the token has full private-repository access.

## 30 July 2026 — Developer workflow Milestone 1 access spike

Status: **preflight and no-charge probe implemented; cross-account PR proof
blocked on a connected second-owner repository**.

### Implemented

- Extracted GitHub repository URL normalization into a shared repository
  boundary while preserving the pricing registry's existing public export.
- Added an injectable Cursor repository-access service that distinguishes:
  - connected repositories;
  - valid but unconnected repositories;
  - a missing GitHub integration;
  - authentication failure;
  - retryable or terminal catalog failure.
- Added `cursor:repository:smoke`, which loads local development environment
  files and performs a read-only Cursor identity/catalog preflight by default.
- Added an explicit write-probe mode that:
  - requires a full repository SHA;
  - requires the normalized repository URL as a confirmation value;
  - requires a reviewed prompt file;
  - starts Cursor Cloud at the exact SHA with `autoCreatePR`;
  - waits for completion and requires both a result branch and PR URL;
  - calls neither the Outcomes quote/task path nor Pinch.
- Added stable non-zero exits for unconnected repositories and failed write
  probes.

### Directly observed verification

- All 13 unit tests pass, including pricing, worker, URL-normalization, and
  repository-access coverage.
- ESLint, TypeScript, IDE diagnostics, and the Next.js production build pass.
- The configured Cursor API key reports a user identity named `wvr-test-key`
  and 23 connected repositories.
- The pinned benchmark fixture preflight returns `connected`.
- `justinleeirizarry/aria51` returns `not_connected` with exit code `2`,
  proving that a public GitHub URL is not treated as writable merely because it
  can be cloned anonymously.
- No Cursor write run, Outcomes quote/task, or Pinch payment was created during
  these checks.

### Authorization findings and evidence limits

- `wvr-test-key` is a personal Cursor user key. It is not the production
  service identity previously assumed by the implementation plan.
- Cursor catalog visibility proves only that a repository is connected to that
  Cursor identity. It cannot prove exact-ref clone, write permission, branch
  protection compatibility, PR base, or eventual PR identity.
- The existing fixture PR proves that one prior personal-key run could create a
  branch and PR. It predates the currently pinned fixture SHA and therefore
  does not prove that today's exact `startingRef` is honored.
- The implemented write probe passes the full SHA to Cursor and requires a
  returned branch and PR URL, but it does not yet independently verify Git
  ancestry or changed-file scope through GitHub.
- A Cursor service-account key can use repositories authorized for its own
  Cursor team; it cannot inherit installations from unrelated customer Cursor
  teams. Cursor does not document a delegated SaaS OAuth flow for Cloud Agent
  launches.
- Customer BYOK is a viable hackathon fallback, but Cursor usage is then billed
  to the customer's Cursor account and cannot be represented as included in an
  Outcomes fixed worker price.
- The recommended product path is an Outcomes GitHub App plus an isolated
  ephemeral local-SDK worker. A deterministic publisher outside the agent uses
  short-lived installation credentials to commit, push, and open the PR.

### GitHub App cross-account proof

- Registered and deployed the Outcomes GitHub App, then installed it on
  `outcomes-test-org` with access limited to the private `real-work`
  repository.
- Initialized the empty repository with a minimal README at pinned SHA
  `6f3c98f13bea5c8de880c2d73c94905ec4635cae`.
- The read-only preflight verified the private repository, `main` ref, pinned
  commit, and non-stale base through installation `150090389`.
- The isolated worker completed with run
  `run-0b9580ca-9d82-4bee-9f39-0d95221b7bdd`, changed only `README.md`, and
  received no GitHub installation credential.
- The deterministic publisher created commit
  `131fe34bb70d0e5bff5c9d72478e1d053ce4191b` and opened draft PR
  https://github.com/outcomes-test-org/real-work/pull/1 through
  `outcomes-worker[bot]`.
- Independent GitHub inspection confirmed the draft PR targets `main`, uses
  branch `outcomes/spike-3e1f0f5e5dbb`, and contains one file with six
  additions and no deletions.
- The reviewer promoted and merged the PR. GitHub reports merge commit
  `dc6c8d57552e59778097ae14ae1e1f4548be19b3`.

### Remaining Milestone 1 work

- Independently review and harden the local SDK sandbox boundary.
- Decide whether customer BYOK remains available as a separately billed
  hackathon fallback.

The GitHub App write path is now proven against one second-owner private
repository. This is evidence for the bounded path, not yet a claim that every
repository policy or task shape is supported.

## 30 July 2026 — GitHub App and isolated-worker implementation

Status: **live second-owner private-repository installation, isolated execution,
draft PR publication, and human-reviewed merge verified**.

### Implemented

- Added an authenticated install redirect and OAuth callback for one
  Outcomes-owned GitHub App.
- Signed install state to the current Outcomes user and a short expiry.
- Exchange the one-time GitHub OAuth code, list installations available to that
  GitHub user, and accept the returned installation only when app ID, app slug,
  and installation ID all match.
- Added `github_app_installations` with account ownership, unique app/account
  binding, RLS, authenticated read-only access, and service-role writes.
- Applied migration `20260730122535_github_app_installations.sql` to the linked
  Supabase project and queried the new table successfully.
- Added repository-scoped installation-token creation for only `contents:
  write` and `pull_requests: write`, with token revocation after clone and after
  publication.
- Added exact-SHA ephemeral checkout creation through `GIT_ASKPASS`; the token
  is present only in the clone process environment and is never written to the
  checkout or remote configuration.
- Moved Git metadata outside the agent workspace before execution.
- Added a separate local Cursor SDK child process with:
  - the Cursor key supplied through consumed standard input rather than the
    environment;
  - a minimal environment and fresh home directory;
  - no user, project, team, MDM, or plugin settings;
  - SDK sandboxing enabled;
  - no GitHub App private key, installation token, Git remote, or Git metadata.
- Added strict publication validation for allowlisted paths, regular text
  files, Git modes, file count, per-file bytes, total bytes, conflicts, and
  immutable baseline SHA.
- Added deterministic GitHub publication outside the agent using blobs, trees,
  one-parent commits, refs, and pull requests.
- Added stale-base rejection before publication and post-creation checks for PR
  base SHA, head SHA, branch, and exact changed-file set.
- Added cleanup that closes a mismatched PR and deletes its branch on
  verification failure.
- Added `github-app:worker:smoke`, read-only by default and write-enabled only
  with an exact repository confirmation, reviewed prompt file, pinned SHA, base
  branch, and explicit allowed paths.
- Added the dashboard installation control and documented registration,
  environment, preflight, and guarded execution.

### Directly observed verification

- All 21 tests pass, including RSA app JWT verification, user/expiry-bound
  installation state, GitHub-user installation verification, external Git
  metadata, allowlisted diff enforcement, deterministic publication identity,
  successful publication evidence, and stale-base fail-closed behavior.
- ESLint, TypeScript, IDE diagnostics, and the Next.js production build pass;
  both GitHub App routes are present in the build output.
- Supabase dry-run identified only the intended installation migration.
- The migration applied successfully to the linked project.
- A service-role count query against `github_app_installations` succeeded and
  returned zero rows, as expected before the first installation.
- The new smoke command starts correctly and reports
  `OUTCOMES_GITHUB_APP_ID is not configured` without starting an agent or
  writing to GitHub.
- Production GitHub App credentials were configured and used to complete the
  authenticated callback for installation `150090389`.
- Read-only preflight proved that private repository
  `outcomes-test-org/real-work` was accessible at the exact, current `main`
  SHA.
- The guarded write spike finished in approximately 29 seconds. Cursor reported
  68,192 total tokens: 45,990 input, 954 output, and 21,248 cache-read tokens.
- Independent GitHub inspection verified PR
  https://github.com/outcomes-test-org/real-work/pull/1, bot attribution,
  base/head branches, commit SHA, the exact one-file change set, and subsequent
  merge commit `dc6c8d57552e59778097ae14ae1e1f4548be19b3`.

### Evidence limits and next action

- The SDK sandbox plus child-process boundary is materially safer than running
  the agent in the credentialed orchestrator, but it is not equivalent to a
  hardened container, VM, seccomp profile, or separate operating-system user.
- Token revocation ran after discovery, clone, initialization, and publication,
  but a separate negative test should prove that a captured revoked token can
  no longer access the repository.
- Repeat the proof with an existing nontrivial repository and independent
  sandbox review before claiming generalized private-repository execution.

## 31 July 2026 — Immutable repository binding and snapshot foundation

Status: **implemented, locally verified, and migrated in production**.

### Implemented

- Added strict, versioned repository identity, snapshot, access-binding, and
  repository-binding contracts.
- Added deterministic canonical JSON and SHA-256 hashing. Snapshot parsing
  rejects a manifest whose stored hash, repository, source ref, or commit does
  not match.
- Ported and hardened the read-only repository scanner with deterministic path
  ordering, conservative file and byte limits, binary/generated/test
  classification, and exclusions for dependencies, build output, Git metadata,
  and symlinks.
- Added GitHub App repository capture that:
  - requires an active installation owned by the requesting Outcomes user;
  - rechecks current GitHub installation identity, permissions, and suspension;
  - verifies canonical repository name and immutable GitHub repository ID;
  - rejects a base branch that no longer points to the requested SHA;
  - verifies the exact commit and tree;
  - uses a repository-ID-scoped, read-only scan token;
  - streams the exact-SHA GitHub archive into an ephemeral workspace;
  - persists the snapshot before its binding;
  - revokes tokens and removes the workspace on success or failure.
- Added atomic, versioned installation claims. Reinstallation creates a new
  active generation and disconnects the previous generation without rewriting
  the installation identity referenced by historical bindings. Cross-account
  ownership claims fail inside the transaction.
- Added immutable `repository_snapshots` and `repository_bindings` tables with
  semantic uniqueness, deterministic-conflict detection, composite
  owner-matching foreign keys, indexed RLS predicates, authenticated
  owner-only reads, and service-role-only inserts.

### Verification

- An independent review identified and prompted fixes for installation-claim
  races, installation generation mutation, mismatched snapshot idempotency,
  valid slash-containing branch names, hidden cleanup failures, and missing
  database assertions.
- All 49 tests pass, including deterministic hashing/scanning, strict contract
  checks, stale-ref rejection, ownership rejection, cleanup aggregation,
  installation claim arguments, and migration contract assertions.
- ESLint, TypeScript, IDE diagnostics, the Next.js production build, and
  `git diff --check` pass.
- The complete migration chain replayed successfully on an isolated local
  Supabase Postgres `17.6.1.147` database.
- Transactional SQL assertions verified:
  - one active installation generation after reinstall;
  - rejection of a second Outcomes owner;
  - rejection of cross-owner binding foreign keys;
  - acceptance of `feature/foo` as a base branch;
  - immutable snapshot updates;
  - absence of authenticated insert and service-role update privileges;
  - owner-only snapshot visibility through RLS.
- `supabase db push --dry-run --linked` identifies only
  `20260730141502_repository_bindings_and_snapshots.sql`.
- Applied that migration to the linked production project with the Supabase
  CLI and confirmed matching local/remote migration history.
- Service-role Data API queries verified one active GitHub App installation
  and empty initial `repository_snapshots` and `repository_bindings` tables.

### Scope boundary and next action

- Quote creation still uses the pinned calculator fixture and
  `FIXTURE_MANIFEST`; pricing expansion is the next slice.
- The new capture service is not yet exposed as a REST, MCP, or CLI operation.

## 31 July 2026 — Task 2 snapshot-backed pricing

Status: **implemented, verified against an isolated local Postgres 17 replay,
and migrated in production**.

### Implemented

- Added API-key-authenticated REST discovery for active GitHub App installation
  generations and repository preflight/capture. Ownership comes only from the
  authenticated principal, and DTOs omit tokens and secrets.
- Added a shared owned-evidence loader that reconstructs strict
  `RepositoryBinding` and `RepositorySnapshot` contracts from persistence and
  rejects mismatched IDs, URLs, SHAs, repository IDs, or manifest hashes.
- Added binding-backed quote creation that analyzes only the persisted
  `snapshot.manifest`. The prior URL/SHA fixture request remains isolated as a
  compatibility path.
- Added non-binding `assessTask` and `POST /api/v1/assessments`, including
  optional Linear workspace/team/project/issue metadata and a required
  caller-supplied normalized issue-content SHA-256. Assessments cannot be
  accepted.
- Separated semantic assessment safety from execution eligibility. A follow-up
  live-flow fix allows estimator-approved, safety-checked tasks only when they
  reference an immutable captured repository binding.
- Replaced the new path's blanket price with an uncalibrated, versioned variable
  policy. Internal evidence itemizes predicted worker high cost, quote analysis,
  verification, retry/risk, payment, margin, and commercial minimum coverage;
  customer DTOs contain only range, confidence, caveat, and safe factors.
- Extended quote contract hashing, replay identity, underwriting, accepted
  tasks, and acceptance events with binding, snapshot, manifest, repository,
  and pricing-policy evidence.
- Added an imperative migration for assessments, composite ownership foreign
  keys, RLS, explicit grants, immutable evidence triggers, and acceptance-time
  repository evidence copying.
- Follow-up hardening made assessment rows service-only, made snapshot quote
  and underwriting creation atomic, required matching underwriting at
  acceptance, returned persisted pricing evidence hashes, bounded internal
  analysis IDs, made expiry durable, narrowed MCP to binding-only input, and
  replaced preflight message matching with typed errors.

### Verification and limits

- Deterministic tests cover differing manifests/prices, actual snapshot-manifest
  use, immutable non-fixture quote eligibility, semantic declines,
  source hashing, idempotency conflicts, owner-derived access, contract-hash
  changes, and migration invariants.
- No repository commands are run during quote analysis, and no installation
  token or internal underwriting amounts are returned in customer DTOs.
- The full migration history, including the new migration, replayed on an
  isolated local Supabase Postgres 17 stack. Transactional assertions verified
  atomic quote/underwriting creation and replay, accepted-task evidence copying,
  immutable underwriting, service-only assessment access, and RPC grants.
  Database lint reported no public-schema errors.
- The migration was applied to the linked production Supabase project. Remote
  migration history and service-role Data API access to `assessments`,
  `quotes`, and `quote_underwriting` were verified after application.
- Production capture was subsequently verified against
  `outcomes-test-org/real-work`. The production adapter now scans a bounded
  GitHub archive without requiring system Git.
- Structured model-assisted classification, calibration runs, additional
  executable verifier profiles, generalized worker prompts/task titles, and
  CLI/MCP assessment parity remain future work.

## 31 July 2026 — Task 3 Outcomes CLI workspace

Status: **implemented and live-verified through production quote, acceptance,
status, and PR return; not published to npm**.

- Added npm workspaces `@outcomes/contracts`, `@outcomes/client`, and
  `@outcomes/cli` with shared REST DTOs, typed client, and the `outcomes` binary.
- Refactored server request schemas to import from `@outcomes/contracts`.
- CLI covers auth status, repo inspect, assess, quote, accept, status/watch, and
  run with Git discovery, idempotency state, JSON output, and stable exit codes.
- Package and root tests include HTTP fakes, git discovery fixtures, state
  idempotency checks, and anti-drift guards against server kernel imports.
- **Not claimed:** npm publication or MCP parity for capture/assessment.

Post-Task 3 blockers:

- Publish `@outcomes/cli` and document supported `npx` usage against a released
  version.
- Add MCP adapters for capture/assessment or document REST-only agent playbooks.
- Add a second trusted verifier profile and durable external execution runner.

## 31 July 2026 — Task 4 isolated execution connection

Status: **implemented, deterministically tested, migrated in production, and
live-verified through deterministic draft-PR publication**.

### Implemented

- Acceptance remains atomic and idempotent but no longer launches a provider
  inside the REST/MCP request. Replays return the same persisted task.
- Added `task_execution_attempts` and service-role-only RPCs for atomic claims,
  20-second heartbeat of a 90-second fenced lease, stale-lease recovery,
  bounded retry backoff, run evidence, fenced terminal failure, and atomic
  publication completion. One invocation claims one isolated task; stale
  claimants cannot renew, fail, publish, or complete it.
- Added one injectable server orchestrator that reconstructs the accepted task,
  quote contract hash, underwriting, binding, snapshot, manifest, installation,
  repository ID, base branch, and exact SHA from persistence.
- Hardened the existing isolated worker to recheck the current GitHub App
  installation, write permissions, repository identity, exact branch tip, and
  commit before cloning the accepted SHA.
- Worker prompts, titles, acceptance criteria, prohibited constraints, and
  allowed paths derive from the accepted persisted contract and immutable
  analysis/manifest evidence.
- Persisted Cursor agent/run evidence before publication. The publisher derives
  mode-sensitive deterministic `outcomes/task-*` branch and commit identities
  and discovers an existing matching open, closed, or merged PR after ambiguous
  retries. Post-success credential/workspace cleanup failures are retained as
  warnings instead of causing duplicate publication.
- Made customer task status read-only and exposed customer-safe attempt state
  while retaining detailed internal failures on the service-only attempt row.
- Added a `CRON_SECRET`-protected, bounded internal route, one-minute Vercel
  cron, and local `tasks:reconcile` command. The same background invocation
  advances trusted verification and exactly-once sandbox payment after worker
  publication; CLI polling is not involved.
- Preserved background legacy Cursor Cloud starts without allowing the isolated
  claimant to adopt them. Added task-keyed verifier dispatch discovery and
  fail-closed ambiguity handling. Pinch crash recovery now queries and reuses
  the deterministic nonce before any same-nonce resubmission.
- Snapshotted immutable Pinch payer/source/amount evidence and added conditional
  state precedence so late ambiguity cannot overwrite approved/pending payment
  or completed-task state. Payment creation and mutation are now service-only,
  and a database trigger protects the reserved provider payload. Verifier
  recovery events and terminal failure are emitted only when their conditional
  transition wins.
- PR recovery now reuses open PRs, reopens closed-unmerged PRs, represents
  merged delivery, rejects multiple exact matches, and can recover an existing
  exact publication after the protected base moves without creating new work.
- Replayed every migration on ephemeral Postgres 17.10 and ran transactional
  assertions for claim exclusion, duplicate claims, lease fencing/renewal,
  retry delay, RLS, and service-role-only RPC grants.

### Safety and limitations

- No charge occurs for worker completion or PR creation. Only the pre-existing
  independent verifier can move a task to the payment service.
- Execution requires an estimator-approved, safety-checked task, immutable
  binding, exact SHA, and persisted source-file scope. Verification is scoped
  to the task repository and base branch.
- Legacy URL/SHA quotes remain compatible and advance through the prior cloud
  lifecycle; they are not claimed by the binding-backed executor.
- Snapshot capture no longer depends on system Git. Isolated execution still
  requires system Git, child-process support, writable temporary storage, and
  adequate memory, so the local/external reconciler remains the controlled
  runner until durable worker hosting is added.
- Cursor token usage is persisted, but the local SDK result does not provide an
  authoritative provider charge. `actual_cost_usd_micros` remains `null`.
- Only validated run/change evidence is durable. The isolated checkout and
  in-flight Cursor process remain ephemeral; a durable external worker and
  globally fenced payment claim are production hardening items.
- The migration was applied to the linked production project. Remote history
  and service-role Data API access to execution, task, and payment evidence
  were verified. Production cron credentials are configured.
- Live evidence: task `07f731b5-b89c-4adb-8f22-498cc2f37a93` accepted an AUD
  6.75 quote, was claimed exactly once by the controlled local runner, persisted
  Cursor run/usage/publication evidence, and opened
  [draft PR #2](https://github.com/outcomes-test-org/real-work/pull/2) from the
  quoted SHA with only `README.md` changed.
- Live verification exposed and fixed two correctness gaps: Postgres rewrites
  UTC timestamp text, so contract hashing now normalizes equivalent timestamps;
  verifier API requests are now scoped to the task repository rather than the
  legacy fixture.
- `real-work` has no trusted `outcomes-verify.yml`, so no successful verifier or
  payment is claimed. The task ended `verification_failed`; a production query
  confirmed that it has no payment row.

### Remaining prerequisites

- Keep `CRON_SECRET`, execution credentials, and the Vercel cron configured in
  the deployment project.
- Add the trusted workflow to a second repository and verify both successful
  sandbox payment gating and no-charge failure.
- Install the Outcomes GitHub App on `w-v-r` before testing
  `w-v-r/search-harness`; the current installation covers only
  `outcomes-test-org`.
