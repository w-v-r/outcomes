# Outcomes developer workflow implementation plan

Last updated: 30 July 2026

## Goal

Deliver two credible hackathon workflows on one control plane:

1. An agent combines Linear MCP with Outcomes MCP to assess the issues in a
   Linear project and show a defensible backlog cost.
2. A developer runs an Outcomes CLI from a Git repository, receives a fixed
   quote, explicitly approves it, and receives a real GitHub pull request after
   execution and independent verification.

The REST application services remain authoritative. MCP, CLI, Linear, and the
console are adapters or projections; none may independently decide price,
eligibility, execution state, verification, or payment.

## Hackathon judge acceptance gate

The implementation is not hackathon-ready merely because the pinned fixture
works. A judge must be able to use a supported repository that is not the
original Outcomes-owned benchmark fixture.

The judge-ready path is:

```text
create account and complete Pinch sandbox setup
  -> create Outcomes API key
  -> run the CLI with npx or configure the hosted MCP
  -> preflight a supported GitHub repository
  -> request a bounded task-specific quote
  -> inspect price, scope, assumptions, and repository SHA
  -> approve explicitly
  -> receive progress without keeping one request open
  -> open the resulting GitHub PR
  -> inspect independent verification
  -> see exactly-once Pinch payment on success
```

The same demo must include a verified failure path that produces no customer
charge.

### Milestone 1 implementation status — 30 July 2026

Implemented:

- authenticated GitHub App install and OAuth callback routes;
- state signed to the current Outcomes user with a ten-minute expiry;
- GitHub-user verification of the returned installation before persistence;
- ownership-protected installation storage with RLS;
- repository-scoped, short-lived installation token minting and revocation;
- exact-SHA clone into an ephemeral checkout with Git metadata removed before
  agent execution;
- a separate local Cursor SDK process with a fresh home, minimal environment,
  no ambient settings, SDK sandboxing, and no GitHub credential;
- fail-closed changed-file, path, mode, text, count, and byte validation;
- deterministic Git Data API publication outside the agent;
- stale-base rejection plus PR base/head and changed-file verification;
- read-only and explicitly confirmed write-spike CLI modes.

Verified locally, against the linked Supabase project, and through the live
GitHub App:

- 21 deterministic tests pass;
- lint and TypeScript pass;
- the migration applied and the installation table is queryable;
- production credentials are configured and the app installation callback
  persisted the `outcomes-test-org` installation with selected-repository
  scope;
- a read-only preflight proved access to the private
  `outcomes-test-org/real-work` repository at pinned SHA
  `6f3c98f13bea5c8de880c2d73c94905ec4635cae`;
- the isolated worker changed only `README.md`, and the deterministic publisher
  opened draft PR https://github.com/outcomes-test-org/real-work/pull/1 as
  `outcomes-worker[bot]`.

Still required before Milestone 1 can be claimed complete:

- independently review the local SDK sandbox boundary; it is process and
  SDK-sandbox isolation, not yet a hardened container or separate VM.

Before claiming this gate, Outcomes must prove all of the following:

- Cursor can clone and modify a second repository through the intended
  production identity and access model.
- The worker can push a branch and open a PR against that repository.
- The verifier can run without trusting worker-modifiable commands or files.
- The price differs meaningfully across several bounded task shapes.
- The quoted price remains above observed worker, verification, payment, and
  retry costs under the enforced execution policy.
- CLI and MCP requests produce the same persisted quote and task semantics.
- A task continues toward a terminal result if the judge closes the CLI or
  stops polling.

For the hackathon, "supported repository" should initially mean a documented,
fail-closed envelope such as GitHub-hosted JavaScript/TypeScript repositories
within size limits, with a clean pushed SHA and a registered or safely inferred
verification profile. Unrestricted arbitrary-repository support is not a
credible first promise.

## Audit snapshot

### Verified live on 30 July 2026

- Local `main` matches the canonical `w-v-r/outcomes` remote commit
  `0e54ed637d76de8e20a0c5dbe08132ed23c575d9`.
- The hosted REST quote endpoint authenticated with `OUTCOMES_API_KEY` and
  returned a new eligible AUD 12.50 quote for the pinned calculator task.
- Hosted MCP initialization and tool discovery returned `quote_task`,
  `accept_quote_and_start`, and `get_task_status`.
- The prior Cursor Cloud run produced the real pull request
  `https://github.com/w-v-r/agent-cost-benchmark-fixture/pull/1`, changing one
  line in `src/calculator.js`.
- The benchmark Linear project is reachable through Linear MCP and contains
  nine issues, including seven bounded tasks and two intentional rejection
  cases.
- The configured Cursor credential is the personal user key `wvr-test-key`,
  not a production service-account key. Its repository catalog contains 23
  `w-v-r` repositories and no cross-account repository.
- The current product test suite passes: 13 tests, TypeScript, ESLint, and the
  production build.
- No quote was accepted during this audit, so no new worker or payment was
  started.

### What exists and should be retained

- Authenticated REST and hosted Streamable HTTP MCP.
- Shared `createQuote`, `acceptQuoteAndStart`, and `getTaskStatus` application
  services.
- API-key ownership, immutable quotes, contract hashes, expiry, and
  idempotency.
- Atomic quote acceptance and task creation in Supabase.
- Cursor Cloud launch configured with a repository URL and exact commit SHA as
  `startingRef`; exact-ref ancestry has not yet been independently proven.
- `autoCreatePR: true`, persisted worker branch/PR references, usage, and
  calculated model cost.
- Trusted GitHub Actions verification before Pinch sandbox charging.
- Separate persisted customer price, predicted cost, internal budget, actual
  cost, task events, and payment state.
- A reusable repository scanner and benchmark corpus in `build-attempt-1`.

### What is still fixture-only or simulated

- Eligibility accepts one repository, one SHA, and one exact task contract.
- Quote creation analyzes an embedded fixture manifest rather than the
  requested repository.
- The AUD 12.50 minimum overwhelms the calculated model-cost quote. The
  reference task's observed model cost is measured in cents, not dollars.
- The estimator uses regex task families, path matching, character-based token
  estimates, and uncalibrated multipliers. Its `decompose` or `decline`
  decision is not an enforced commercial gate.
- The worker prompt and verifier dispatch contain fixture-specific rules.
- GitHub verification always targets the fixture repository and fixed workflow.
- Progress, verification, and charging advance only when the customer polls
  task status.
- The dashboard payment demo bypasses the real worker and verifier.
- There is no product CLI, Linear integration, batch assessment API, task
  history UI, or end-to-end service test.

## Important product distinction

Backlog costing and executable fixed quotes are different products and must not
share a misleading lifecycle.

### Assessment

An assessment is a non-binding planning estimate:

- suitable for many Linear issues;
- may return a range, confidence, assumptions, rejection, or decomposition;
- tied to an issue-content hash and repository snapshot;
- does not expire into an executable contract;
- cannot be accepted and cannot start work.

### Quote

A quote is a short-lived commercial contract:

- one bounded task;
- exact repository URL, base branch, and 40-character commit SHA;
- exact normalized task contract and verifier profile;
- one fixed customer price and contract hash;
- can be accepted exactly once to start work.

Linear project costing should use assessments. When a developer chooses an
issue, Outcomes refreshes repository state and creates an executable quote.
This avoids presenting stale backlog estimates as fixed commitments after
dependencies merge or issue descriptions change.

## Target architecture

```text
Linear MCP ─┐
            ├─ agent orchestration ─ Outcomes MCP ─┐
Local git ─ Outcomes CLI ──────────────────────────┤
Outcomes Console ─────────────────────────────────┤
                                                   v
                                      REST application services
                                      ├─ repository snapshots
                                      ├─ eligibility/classification
                                      ├─ pricing/underwriting
                                      ├─ quote acceptance
                                      ├─ task orchestration
                                      ├─ verification
                                      └─ billing
                                                   |
                       Supabase <───────────────────┼─> Cursor Cloud
                                                   ├─> GitHub
                                                   └─> Pinch
```

MCP may call the application services in-process, as it does now. The CLI must
call the hosted REST API and must not contain a second pricing implementation.

### One kernel, multiple adapters

Outcomes should adopt the useful dependency direction demonstrated by
[`aria51`](https://github.com/justinleeirizarry/aria51), while accounting for
the fact that Outcomes is a stateful hosted financial control plane rather than
a local scanner.

aria51 separates:

```text
@aria51/core
  -> aria51 CLI
  -> @aria51/mcp
```

Both adapters import the same scanning operations. Outcomes needs the analogous
shape:

```text
private server application kernel
  ├─ repository preflight and snapshots
  ├─ assessment, eligibility, and underwriting
  ├─ quote creation and acceptance
  ├─ task orchestration and reconciliation
  ├─ verification and billing
  └─ canonical structured result types
       ├─ REST route adapter
       ├─ hosted MCP adapter
       └─ console server adapter

typed REST client
  └─ published CLI adapter
```

The CLI cannot import or execute the private server kernel because that would
move Supabase, Cursor, GitHub, Pinch, pricing policy, and commercial authority
onto a customer machine. It consumes the same kernel through REST. The hosted
MCP may invoke the kernel in-process to avoid a redundant network hop. Both
paths use the same input schemas, output DTOs, error codes, and contract tests.

### Proposed workspace boundaries

Do not switch package managers merely to copy aria51. Retain npm and the
existing lockfile, adding workspaces only when the CLI is introduced:

```text
src/lib/control-plane/             private authoritative application services
src/lib/pricing/                   private pricing and underwriting policy
src/lib/workers/                   private worker providers
src/lib/verifiers/                 private verifier providers
src/app/api/v1/                    thin REST routes
src/app/api/mcp/                   thin hosted MCP transport

packages/contracts/                public DTOs, Zod schemas, status/error codes
packages/client/                   typed Outcomes REST client
packages/cli/                      npx-compatible human/JSON CLI
```

`packages/contracts` must contain no database access, provider credentials,
price policy implementation, or task transitions. `packages/client` knows HTTP,
authentication, retries, and serialization only. `packages/cli` knows local Git
discovery, approval UX, formatting, and exit codes only.

### Structural ideas to borrow from aria51

- A public stable core surface instead of adapters importing arbitrary internal
  files. For Outcomes, the public surface is the REST contract and
  `packages/contracts`; the private surface is a narrow application-service
  index.
- Separate published CLI and MCP entry points with explicit dependency
  direction.
- An `npx`-compatible CLI with a minimal executable shim.
- Human-readable TTY output plus deterministic non-TTY/JSON output.
- Logs on stderr so stdout remains valid JSON or JSON-RPC.
- Central validation, configuration, typed errors, and stable exit codes.
- Package-local tests plus integration tests that replace the kernel with
  fakes.
- Progress callbacks/events produced by the core operation and rendered
  differently by each adapter.

### Structural ideas not to copy

- Do not let MCP tools directly instantiate provider resources or implement a
  second workflow. Some aria51 MCP tools call Playwright directly rather than
  one shared orchestration operation; Outcomes must keep Cursor, GitHub,
  Supabase, and Pinch behind the application kernel.
- Do not duplicate input schemas or customer-safe formatters across the CLI,
  MCP route, and REST routes.
- Do not move commercial configuration into a local config file.
- Do not add Effect, Ink, pnpm, or a monorepo conversion unless each solves a
  concrete Outcomes requirement. The architecture is the pattern to borrow,
  not every dependency.
- Do not expand the MCP into many overlapping tools. Keep assessment, quote,
  acceptance, and status boundaries explicit and small.

### Anti-drift enforcement

Prevent CLI/MCP divergence mechanically:

- export one canonical schema per operation from `packages/contracts`;
- expose one server function per operation from the private kernel;
- make every REST and MCP handler a short parse/authenticate/call/project
  adapter;
- generate or hand-maintain the typed client from the same schemas;
- run parity tests that send equivalent requests through REST and MCP and
  compare persisted results;
- forbid imports from `src/lib/pricing`, `src/lib/workers`,
  `src/lib/verifiers`, or Supabase inside `packages/cli`;
- version REST, MCP server metadata, contracts, pricing policy, and CLI
  independently but record all versions on assessments and tasks.

## Repository binding and execution environment

### Repository authorization decision

Cursor repository authorization is scoped to the Cursor user or team behind
the API key and that tenant's Cursor GitHub App installation. An Outcomes-owned
service-account key cannot inherit repositories connected to unrelated
customer Cursor teams, and Cursor does not document a delegated SaaS OAuth
flow for launching Cloud Agents on a customer's behalf.

Two viable modes remain:

1. **Hackathon BYOK fallback:** the customer connects their repository to
   Cursor and supplies a Cursor user or team service-account key to Outcomes.
   This is the shortest route to Cursor-hosted Cloud Agents, but it requires
   secure storage of a broad bearer credential and bills Cursor usage to the
   customer's Cursor account. It must not be presented as an all-inclusive
   Outcomes worker price.
2. **Primary product path:** the customer installs an Outcomes GitHub App on
   selected repositories. Outcomes obtains short-lived installation tokens,
   clones the exact SHA into an isolated ephemeral worker, runs the Cursor SDK
   in local mode using an Outcomes-owned model credential, and publishes the
   branch and PR deterministically through the GitHub App. The agent must not
   receive the GitHub installation token.

The second path preserves low-friction repository onboarding, tenant
isolation, revocation, and all-inclusive quote economics. Customer-hosted
workers may later be offered for security-sensitive organizations.

### Canonical repository binding

Every assessment, quote, task, worker run, verifier run, and PR must refer to a
versioned `RepositoryBinding`:

```text
provider: github
repository_url: canonical HTTPS URL
repository_owner_and_name: owner/repo
base_branch: branch intended for the PR
base_sha: immutable 40-character commit
visibility: public | private
access_binding: versioned GitHub App installation or explicit BYOK reference
manifest_hash: hash of the analyzed repository snapshot
```

An optional external source binding records Linear provider, workspace, team,
project, issue ID/URL, and normalized issue-content hash. It is metadata for
traceability, not pricing authority.

### CLI discovery

The CLI should:

```text
locate the git root
  -> require a GitHub remote, preferring upstream then origin
  -> normalize SSH or HTTPS remote to canonical HTTPS
  -> resolve HEAD to a full commit SHA
  -> require HEAD to exist on the remote
  -> reject a dirty worktree for executable quotes
  -> identify the base branch or require --base
  -> call repository preflight
  -> submit the exact binding with the task contract
```

The CLI may inspect the local checkout for user feedback, but server-side
preflight and the server-owned snapshot remain authoritative.

### Analysis and execution environments

Two environments are needed at different moments:

1. Quote-time analysis uses a read-only ephemeral checkout or GitHub tree
   snapshot at the exact SHA. It must not execute repository code.
2. After explicit acceptance, an isolated ephemeral worker clones the bound
   repository at `base_sha`, runs the Cursor SDK with explicit sandboxing,
   captures the resulting diff and usage, and exits. A deterministic publisher
   outside the agent commits, pushes, and opens the PR through a fresh
   short-lived GitHub App token.

Outcomes should not create an execution VM before approval. It should confirm
repository access and exact-ref existence before offering an executable quote
so acceptance cannot fail immediately because GitHub cannot read or write the
repository. A BYOK fallback may continue using Cursor-hosted Cloud Agents, but
its separate Cursor billing must be explicit.

### Repository access rollout

Support should widen in controlled tiers:

1. Pinned fixture, current behavior.
2. Allowlisted hackathon repositories with registered verifier profiles and a
   proven BYOK or Outcomes GitHub App access binding.
3. Public GitHub repositories passing size, language, and verification policy.
4. Private repositories connected through an Outcomes GitHub App installation
   and isolated worker, with customer-hosted execution as a later option.

"Any repository" is not one boolean switch. Access, checkout size, supported
toolchain, safe verification, and write permission must all pass independently.

## Pricing model v2

### Pipeline

```text
normalize task and external source
  -> snapshot repository at exact SHA
  -> deterministic safety and feasibility gates
  -> static repository analysis
  -> structured LLM task classification
  -> working-set and change-surface prediction
  -> execution and verification cost distributions
  -> success probability and tail-risk allowance
  -> commercial policy and customer-safe explanation
  -> persist complete versioned underwriting decision
```

### Deterministic repository analysis

Port the reusable scanner from `build-attempt-1` into server-only product code:

- file tree, byte/line/token approximations, languages, packages, lockfiles;
- tests and likely test commands without running them;
- generated, binary, and oversized files;
- monorepo/package boundaries;
- imports or dependency graph where practical;
- task-keyword and explicit-path retrieval;
- repository-size and unsupported-toolchain gates.

Cache manifests by canonical repository URL and SHA. Store a manifest hash on
every assessment and quote.

### Structured LLM classification

Use a dedicated classification model call with a strict schema:

- task family and requested behaviors;
- interface count and change surface;
- likely files/packages and confidence;
- ambiguity, contradictions, external dependencies, and missing decisions;
- verification strategy and coverage risk;
- decomposition suggestion;
- semantic rejection reasons.

The classifier is evidence for a deterministic policy, not sole pricing
authority. Hard safety, repository, and verification gates cannot be bypassed
by an LLM confidence score.

### Cost and customer price

Estimate distributions rather than one token number:

- input, output, cache, and reasoning tokens by likely worker route;
- tool calls and wall-clock time;
- repository analysis/classification cost;
- independent verification cost;
- retry/remediation allowance;
- payment fee where applicable;
- success probability and tail loss.

Keep these fields separate:

```text
predicted_execution_cost
predicted_verification_cost
quote_generation_cost
internal_cost_budget
risk_and_remediation_allowance
payment_fee
target_margin
fixed_customer_price
actual_execution_cost
actual_verification_cost
realized_margin
```

Replace the blanket AUD 12.50 floor with a versioned commercial policy. A
minimum transaction price may remain, but the response must show when it is a
commercial minimum rather than pretending it was produced by task complexity.
For the hackathon, expose the customer-safe factors and confidence without
revealing exploitable internal thresholds.

### Calibration

Create a labelled evaluation corpus from the nine Linear issues plus additional
repositories and task families. For every completed or rejected task, retain:

- classifier output and human label;
- predicted ranges and final quote;
- selected worker model/runtime;
- actual usage and provider cost;
- verification and remediation cost;
- completion, rejection, or failure reason;
- predicted versus realized margin.

Track interval coverage, median and tail error, false acceptance/rejection,
success rate, and margin by task family. Do not claim calibrated fixed pricing
until the corpus contains materially more than the current two successful
benchmark executions.

## Worker, PR, and verification loop

### Worker

- Remove fixture-specific prompt instructions.
- Generate execution constraints from the persisted contract and repository
  policy.
- Pass an explicit model variant and supported limits.
- Record startup failure separately from an executed run failure.
- Persist agent/run IDs immediately and reconcile usage from Cursor.
- Enforce available token/tool/wall-clock cancellation controls and represent
  overruns as a no-charge terminal result.
- Require a result branch and PR URL for successful developer-facing tasks.

### Durable reconciliation

Move progress out of `GET /tasks/:id`:

```text
accept quote atomically
  -> enqueue/claim worker start
  -> reconcile worker independently
  -> dispatch verifier idempotently
  -> reconcile verifier independently
  -> charge exactly once after verified success
  -> expose read-only status at all times
```

A scheduled Vercel job or small queue worker is sufficient for the hackathon if
claims and transitions are idempotent. Status polling may request a refresh but
must not be required for progress.

### Verification

Do not accept arbitrary shell commands from customers and execute them on
trusted Outcomes infrastructure.

For the hackathon, register an allowlisted `VerifierProfile` for each supported
repository:

- protected baseline SHA and base branch;
- immutable workflow identity or Outcomes-owned isolated verifier;
- allowed test/build commands;
- files the worker may not modify;
- expected checks and criterion-level evidence.

General repository support later requires GitHub App onboarding, tamper checks
for workflow/tests, isolated execution, time/network/resource limits, and a
clear unsupported result when independent verification is not credible.

## MCP and Linear workflow

### MCP surface

Retain:

- `quote_task`
- `accept_quote_and_start`
- `get_task_status`

Add:

- `assess_task` for non-binding planning estimates.
- Optionally `assess_tasks` after the single-assessment contract is stable; an
  agent can initially call `assess_task` once per issue.

All tools delegate to shared application services and return structured content
with customer-safe explanations, assumptions, confidence, and reason codes.

### Hackathon Linear demo

Do not put a Linear credential in Outcomes for the first slice. Use MCP
composition:

```text
agent loads Linear project and issues
  -> resolves the project repository and one repository snapshot
  -> normalizes each issue into an Outcomes task contract
  -> hashes the issue content
  -> calls Outcomes assess_task for each issue
  -> shows total range and per-issue status
  -> clearly labels contradictory/unpriceable issues as rejected/decompose
  -> optionally posts immutable assessment summaries to Linear comments
```

WIL-44 must be rejected as contradictory. WIL-43 must be rejected or decomposed
as an externally controlled business outcome. The other issues should produce
meaningfully different ranges: a README change, arithmetic operation, CLI, and
expression parser must not collapse to the same estimate.

When an issue is selected for work, refresh its description/content hash and
the current repository SHA, then create a fixed quote. Never accept an old
assessment or a quote tied to a changed issue or stale base SHA.

## CLI developer experience

### Commands

```text
outcomes auth status
outcomes repo inspect [--base <branch>]
outcomes assess --task <text|file>
outcomes quote --task <text|file>
outcomes accept <quote-id>
outcomes status <task-id> [--watch]
outcomes run --task <text|file>
```

`outcomes run` is the demo convenience command. It performs discovery, requests
a quote, prints the exact contract and price, asks for interactive approval,
accepts only on an explicit yes, watches the task, and prints a clickable PR
URL plus verification/payment outcome. Non-interactive execution requires an
explicit `--yes --contract-hash ...` or equivalent CI-safe approval artifact.

### CLI constraints

- TypeScript package using the hosted REST contract.
- API key from `OUTCOMES_API_KEY`; never accept it as task text or print it.
- JSON output mode for agents and CI; readable output for humans.
- Stable exit codes for rejected assessment, declined approval, worker failure,
  verification failure, payment failure, and success.
- Idempotency keys persisted in a local Outcomes state directory so retries do
  not create duplicate quotes or runs.
- Resumable watch by task ID.
- No local pricing or worker implementation.

## Delivery sequence

### Milestone 0 — Lock the baseline and adapter contract

- Preserve the fixture E2E path and current deployed API contract.
- Add service-level fakes for worker, verifier, charging, and repository
  analysis.
- Add an opt-in live smoke script that creates a quote but never accepts it.
- Record the current 12.50-floor behavior as a legacy-policy regression.
- Define canonical operation schemas, DTOs, error codes, and adapter parity
  tests before adding the CLI.

Exit: existing fixture quote, MCP tools, worker PR evidence, tests, typecheck,
lint, and build remain green; REST and MCP are demonstrably thin projections of
the same service results.

### Milestone 1 — Cross-account repository and PR access spike

- Create or obtain a second GitHub repository not owned through the same access
  path as the fixture.
- Record that the current key is personal and that Cursor catalog visibility
  alone does not prove exact-ref clone, push, PR-base, or PR identity.
- Decide whether the hackathon ships BYOK as an explicit fallback while the
  primary GitHub App worker path is implemented.
- For BYOK, test a customer-owned private repository connected to that
  customer's Cursor identity and disclose separate Cursor billing.
- For the product path, create an Outcomes GitHub App, install it on a safe
  second-owner repository, clone a pinned SHA with a short-lived installation
  token, execute in an isolated local SDK worker, and publish without exposing
  the token to the agent.
- Independently prove PR base and head ancestry, changed-file scope, branch
  push, PR creation, and author/installation attribution.
- Do not charge and do not generalize eligibility during the spike.

Exit: one real PR exists in a second repository through the intended production
authorization model, with exact-SHA ancestry and access revocation documented.
If only BYOK passes, the demo may proceed with a visible separate-billing
limitation, but Outcomes must not claim all-inclusive worker pricing. If neither
passes, repository authorization remains the blocker and CLI work does not
begin.

### Milestone 2 — Repository binding and snapshots

- Add versioned repository/external-source binding schemas.
- Add GitHub access/ref preflight and immutable snapshot storage keyed by
  canonical URL/SHA.
- Port and harden the read-only repository scanner.
- Replace `FIXTURE_MANIFEST` in quote analysis with the requested snapshot.
- Keep execution eligibility allowlisted while analysis broadens.

Exit: two different SHAs or repositories produce different immutable manifests,
and inaccessible, stale, oversized, or unsupported refs fail before quote
creation.

### Milestone 3 — Generalize narrow execution and verification

- Replace the fixture worker prompt and fixed SQL task title.
- Register at least two allowlisted repository verifier profiles.
- Add explicit base branch and repository-access bindings to task execution.
- Add durable background reconciliation and verifier-dispatch idempotency.
- Wire model selection, actual usage, and available limits to over-budget
  terminal behavior.
- Exercise verified success and no-charge failure on the second repository.

Exit: two repositories can execute bounded tasks and produce independently
verified PRs without customer polling driving progress.

### Milestone 4 — Assessment, pricing v2, and calibration runs

- Add `assessTask` application service and REST/MCP adapter.
- Add structured LLM classification with deterministic fail-closed policy.
- Enforce `accept`, `decompose`, and `decline` decisions.
- Implement versioned variable pricing and customer-safe rationale.
- Evaluate all nine Linear issues against expected labels and ordering.
- Execute several bounded tasks across the supported envelope and compare
  predicted upper bounds with actual worker and verifier costs.
- Set the commercial minimum, risk allowance, and internal budget from observed
  evidence rather than one fixture constant.

Exit: WIL-44 and WIL-43 cannot become executable quotes; bounded issues receive
non-identical, explainable ranges; completed calibration tasks remain within
their internal budgets and the fixed customer price covers observed costs.

### Milestone 5 — Product CLI and MCP parity

- Introduce npm workspaces for `contracts`, typed `client`, and `cli` only.
- Build the thin REST CLI with repo discovery, doctor/preflight, assessment,
  quote, accept, status, and run commands.
- Add interactive approval, stable exit codes, stderr logging, and JSON output.
- Add resumable watching and clickable PR output.
- Publish an `npx`-compatible package.
- Run cross-adapter contract tests for REST, hosted MCP, and CLI.

Exit: from a clean supported repository, a judge can use one `npx` command to
receive a defensible quote, approve it, and reach a real independently verified
PR without constructing JSON manually. The equivalent MCP flow persists the
same semantics.

### Milestone 6 — Linear MCP demo

- Add external-source metadata and issue-content hashes.
- Create an agent playbook/prompt for Linear MCP plus Outcomes MCP.
- Assess the benchmark project and render totals, ranges, confidence, and
  rejection/decomposition reasons.
- Optionally write versioned assessment/result comments back to Linear.

Exit: the project can be re-assessed idempotently, changed issues invalidate old
assessments, and no issue is executed during backlog costing.

### Milestone 7 — Console evidence and economics

- Replace or clearly label the simulated dashboard path.
- Add owned quote, assessment, task, and task-detail views.
- Show contract, repository/SHA, timeline, PR, verification, quoted price,
  predicted/actual costs, Pinch payment, and realized margin as appropriate.
- Make the exactly-once success charge and no-charge failure story obvious.

Exit: an MCP- or CLI-created task can be inspected end to end in the console,
with Pinch visibly moving money only after the verified outcome.

## Test strategy

### Fast deterministic tests

- Repository URL/ref normalization and dirty/stale state.
- Manifest construction, hashing, caching, exclusions, and size limits.
- Task normalization and issue-content hashing.
- Eligibility matrix, especially contradiction and external-outcome cases.
- Pricing component math, interval ordering, policy versions, and contract hash.
- CLI repo discovery, output, approval, idempotency, and exit codes.

### Model evaluation tests

- Versioned labelled corpus with expected family, scope, rejection, and
  decomposition labels.
- Repeat classification to measure variance.
- Prompt-injection and adversarial task descriptions.
- Fail closed on malformed output, timeout, or unavailable classifier.
- Compare model-assisted estimates with the deterministic baseline.

### Service orchestration tests

Use injected fakes and a test database to cover:

- quote replay and changed-body conflict;
- approval hash/expiry/ownership/billing gates;
- worker startup failure versus run failure;
- worker success with and without a branch/PR;
- budget cancellation;
- verifier pass/fail/timeout and duplicate dispatch recovery;
- exactly-once charging and no-charge failure paths;
- background reconciliation without status polling.

### HTTP, MCP, and CLI contracts

- REST status codes and response schemas.
- MCP auth, discovery, tool error mapping, and explicit approval boundary.
- CLI against a local mock server, then deployed sandbox.
- Cross-adapter parity: the same request produces the same assessment, quote,
  task, and status through REST, MCP, and CLI.

### Fixture integration tests

Maintain several immutable fixture SHAs:

- passing baseline plus bounded bug fix;
- contradictory task;
- oversized context;
- missing tests;
- monorepo or multiple package task;
- worker changes prohibited file;
- verifier failure;
- worker over budget.

Do not reuse a mutable branch as the pricing identity.

### Gated live E2E

Run manually or in a secrets-enabled workflow:

```text
create API key
  -> create quote
  -> approve explicitly
  -> isolated worker produces a bounded diff
  -> deterministic publisher opens PR
  -> background reconciler dispatches verifier
  -> verifier passes or fails
  -> payment occurs only on verified success
  -> repeated operations create no duplicate run, verifier, or charge
```

Test both verified success and no-charge failure. Use disposable branches/PRs
and keep payment sandbox-only.

## Immediate implementation slice

The first implementation slice is Milestone 1 plus the minimum test foundation
from Milestone 0:

1. Select a second repository whose write authorization differs from the
   existing fixture.
2. Register an Outcomes GitHub App and install it only on that repository.
3. Prove short-lived-token clone at an exact SHA without exposing the token to
   an agent.
4. Run one bounded local SDK task in an isolated ephemeral worker using the
   Outcomes Cursor credential.
5. Publish the branch and PR outside the agent, then verify base/head ancestry,
   changed-file scope, and installation attribution.
6. Preserve the existing fixture lifecycle and avoid widening public quote
   eligibility during the spike.
7. Keep the implemented Cursor catalog/Cloud probe as a BYOK diagnostic, not
   as evidence that an Outcomes-owned identity can access arbitrary customer
   repositories.

This resolves the highest-risk judge-flow assumption before investing in the
CLI. Once it passes, the next coding slice is repository binding and immutable
snapshots.

## Explicitly deferred from the first slice

- Native Linear OAuth/webhooks.
- Automatic execution of every Linear issue.
- Unrestricted private-repository support.
- Customer-supplied verifier commands.
- Real-money charging.
- Claims that the pricing model is calibrated.
