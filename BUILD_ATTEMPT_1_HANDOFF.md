# Pricing and Cursor Execution Prototype — Handoff

Last verified: 26 July 2026

## Purpose

`build-attempt-1` is a working research prototype for two questions:

1. Can we estimate the model cost and risk of a bounded coding task before execution?
2. Can we wrap a Cursor agent with enough telemetry and guardrails to compare the estimate with reality?

It is not yet the Outcomes product or control plane. It is a benchmark laboratory whose reusable parts should be ported into the product described by:

- `.cursor/plans/control_plane_integration_606e84c5.plan.md`
- `OUTCOMES_IMPLEMENTATION_PLAN.md`

The control-plane integration plan is the architectural source of truth. The main boundary is:

> REST owns business rules and persistent state. MCP and CLI are thin adapters. Cursor Cloud performs work. Supabase records the lifecycle. A bounded server-owned verifier decides whether the promised result was delivered.

## Current status

The prototype is implemented in `build-attempt-1/` and currently passes:

```text
npm run check
npm test

1 test file passed
8 tests passed
```

The workspace root and `build-attempt-1` are not currently Git repositories. Preserve the files deliberately when moving work into the product repository.

### What works

- Local-directory and pinned-GitHub repository inputs.
- Deterministic repository manifests with file sizes, approximate tokens, language/package signals, tests, generated files, binaries, and oversized files.
- Task analysis that estimates clarity, boundedness, verifiability, task family, and likely relevant files.
- A replaceable `CostEstimator` interface with a zero-history heuristic implementation.
- Runtime-specific calibration from previous JSONL records.
- A versioned model rate card.
- Local and cloud Cursor SDK runners.
- Explicit Composer 2.5 standard selection using `fast=false`.
- Token, cache-read, output, tool-call, duration, and estimated/billed-cost capture.
- Cloud usage reconciliation through Cursor's usage endpoint.
- Wall-clock, token, cost, and tool-call cancellation attempts.
- Cursor hooks for oversized reads, tool-call limits, and disabling subagents.
- Local execution in isolated temporary copies.
- Post-execution verification and structured verifier output.
- Append-only JSONL run records.
- JSON and Markdown estimate/benchmark reports.
- A self-contained calculator repository and task fixtures.

### Main files

- `build-attempt-1/src/domain.ts` — Zod contracts and ledger types.
- `build-attempt-1/src/repository.ts` — checkout resolution and static repository analysis.
- `build-attempt-1/src/task-analysis.ts` — deterministic task features and working-set selection.
- `build-attempt-1/src/estimator.ts` — heuristic cost, success, decision, and allowance calculation.
- `build-attempt-1/src/rate-card.ts` — versioned model pricing and usage-cost calculation.
- `build-attempt-1/src/runner.ts` — local/cloud Cursor execution, streaming telemetry, cancellation, and cloud usage reconciliation.
- `build-attempt-1/src/workflow.ts` — synchronous execute, verify, compare, and record flow.
- `build-attempt-1/src/ledger.ts` — JSONL persistence and simple historical summaries.
- `build-attempt-1/src/verifier.ts` — shell-command verifier.
- `build-attempt-1/src/cli.ts` — research CLI.
- `build-attempt-1/tests/core.test.ts` — current regression baseline.
- `build-attempt-1/config/rate-card.json` — current model/rate selection.
- `build-attempt-1/fixtures/` — benchmark repository and task corpus.
- `build-attempt-1/artifacts/` — estimates and observed execution records.

## What has been demonstrated

The pinned benchmark repository is:

```text
https://github.com/w-v-r/agent-cost-benchmark-fixture
20671f01638d8df245f2a2cc2fed7d3e914829fd
```

The same zero-division fix was successfully executed and independently verified locally and in Cursor Cloud. The ledgers contain six authenticated attempts in total:

- Local: two finished and verified; one cancelled after a soft-token overrun.
- Cloud: two finished and verified; one cancelled after a tool-call overrun.

No other fixture task has been executed by an agent. The contradictory, oversized-context, open-scope, and remaining Linear tasks currently have dry-run estimates only.

The latest-per-runtime comparison in `artifacts/reality-benchmark.md` intentionally selects one successful verified run from each route:

- Local: 124,736 tokens, seven unique tool calls, actual model cost `$0.046745`.
- Cloud: 97,655 tokens, eight unique tool calls, actual model cost `$0.0254091`.
- Mean actual model cost: approximately `$0.0361`.
- Mean absolute error of the central estimate: approximately `$0.0211`.

This is evidence that the end-to-end research loop works. It is not enough data to claim that the estimator is accurate or calibrated.

An earlier cloud run was cancelled after exceeding the tool-call allowance and still consumed 112,740 tokens at approximately `$0.0290`. A local attempt was also cancelled after a soft-token overrun. These runs are important evidence that cancellation and hooks reduce risk but do not create a strict per-task dollar ceiling.

Nine Linear-oriented fixture tasks exist in `fixtures/linear-tasks.json`, and local/cloud dry-run estimates were produced. The tasks include normal calculator changes, contradictory requirements, and an externally controlled revenue outcome. The deterministic estimator incorrectly marked every one as `accept_with_conditions`, including the two semantically unpriceable tasks. This is the clearest current eligibility failure.

## Linear benchmark project

The live benchmark backlog is:

- Project: https://linear.app/william-makes-things/project/example-project-for-pinch-hackathon-8daff66efd56/overview
- Linear project ID: `7e582bbb-c4a8-470b-9053-6e52b483b37b`
- Team: `William-makes-things`
- Repository: https://github.com/w-v-r/agent-cost-benchmark-fixture
- Initial pinned baseline: `20671f01638d8df245f2a2cc2fed7d3e914829fd`
- Local task mirror: `build-attempt-1/fixtures/linear-tasks.json`
- Generated estimates: `build-attempt-1/artifacts/linear-local-estimates.*` and `linear-cloud-estimates.*`

### Existing issue map

- `WIL-39` — fix division by zero; calibrated reference task with verified local and cloud executions.
- `WIL-40` — add subtraction; blocked by `WIL-39`.
- `WIL-46` — add multiplication; blocked by `WIL-39`.
- `WIL-41` — add average with validation; blocked by `WIL-39`.
- `WIL-42` — add the calculator CLI; blocked by `WIL-39`.
- `WIL-47` — add the bounded expression evaluator; blocked by `WIL-39`.
- `WIL-45` — document the API and runnable examples; blocked by `WIL-39`.
- `WIL-44` — intentionally contradictory division behavior; must be rejected.
- `WIL-43` — intentionally unpriceable `$10,000/month` revenue guarantee; must be rejected or decomposed into discovery.

The non-reference issues should not be executed blindly against the initial SHA. After `WIL-39` is merged, load the latest intended base commit, pin its exact SHA, and produce a new assessment and quote. A dependency changing the repository invalidates estimates made against the old state.

### How to interact with the project

Use the installed Linear MCP rather than scraping the website. Tool names observed during setup were `get_project`, `list_issues`, `save_issue`, and `save_comment`; discover their current schemas before calling them because MCP tool contracts may change.

For a new working session:

```text
1. Load the project by slug or project ID.
2. List existing project issues before creating anything.
3. Resolve the requested issue by stable Linear identifier.
4. Read its description, links, dependencies, and current state.
5. Confirm the repository URL and determine the exact base commit SHA.
6. Normalize the issue into the Outcomes task contract.
7. Run eligibility before cost estimation.
8. Produce a customer quote only if the final policy permits it.
9. Post a clearly labelled estimate/quote comment to the issue.
10. Start work only after explicit quote acceptance.
11. Post terminal verification, actual cost, and result links as a new comment.
```

Do not treat a Linear issue title alone as a task specification. Each benchmark issue was deliberately written with:

- one bounded outcome;
- explicit acceptance criteria;
- prohibited changes;
- verification expectations;
- a repository link;
- a pinned or pin-before-execution baseline;
- an underwriting purpose where the task is intentionally invalid.

When creating more benchmark issues, preserve that structure and add a mix of:

- routine bounded fixes;
- tasks with different implementation breadth;
- documentation and test work;
- dependency-sensitive tasks;
- unclear tasks that should request clarification;
- contradictory tasks;
- externally controlled or subjective outcomes;
- tasks that should become paid discovery.

Do not populate the corpus only with easy positive examples. False acceptance is the important underwriting failure.

### Comment format and lifecycle

The existing comments contain:

- estimator and version;
- model route and parameters;
- eligibility decision and confidence;
- local and cloud central/high execution-cost estimates;
- conditions such as repinning after dependencies merge;
- verifier caveats;
- a warning that execution cost is not the customer price.

`WIL-39` additionally records actual local/cloud cost, tokens, and independent verification. `WIL-44` and `WIL-43` preserve the incorrect heuristic output, followed by a manual safety override. Do not remove or rewrite those discrepancies; they are useful calibration evidence.

Future product-generated comments should be append-only snapshots and include:

- Outcomes quote ID and URL;
- issue ID and repository SHA;
- eligibility and customer-safe reason;
- fixed customer price and currency;
- scope, conditions, and exclusions;
- quote expiry;
- contract hash;
- verifier profile;
- explicit instruction for accepting the quote;
- an idempotency marker so retries do not create duplicate comments.

After execution, add a separate result comment containing:

- Outcomes task ID and status URL;
- branch or pull-request link;
- verifier result and customer-safe evidence;
- predicted versus actual model cost for internal/demo views;
- whether the customer will be charged;
- the reason when work was stopped or verification failed.

Never overwrite an old quote comment after the issue, repository, policy, or price changes. Expire the old quote and post a new version. Linear comments are an audit-friendly projection, but Supabase remains the authoritative record.

### Linear discoveries and product consequences

#### Repository state is part of the contract

Issue dependencies made it obvious that a task cannot be priced only from its prose. `WIL-40` and the other follow-up tasks are priced against a repository state that changes when `WIL-39` merges.

Build:

- exact repository SHA storage on every assessment and quote;
- automatic quote invalidation when the base SHA changes;
- dependency-aware re-estimation;
- canonical repository URL normalization;
- visible “estimate is stale” state.

#### The existing test suite is not always an independent verifier

For new functions, an agent can write implementation and tests that agree with each other while still violating the intended contract. `npm test` is therefore insufficient on its own for several issues.

Build:

- server-owned verifier profiles;
- hidden contract tests for eligible task families;
- criterion-level evidence;
- separate agent-produced tests from independent verification;
- a verifier-coverage assessment during underwriting.

Examples from the backlog include hidden arithmetic cases, process-level CLI assertions, an expression corpus, and executable documentation examples.

#### Task breadth is not captured well enough

The heuristic priced subtraction, a CLI, and a small expression parser almost identically. Repository working-set size and task-family keywords do not represent algorithmic breadth, interface count, edge-case count, or verification effort.

Build features for:

- number of requested behaviors and interfaces;
- edge-case and error-path count;
- likely files created versus edited;
- implementation novelty;
- test-generation and verification breadth;
- dependency and sequencing risk;
- a paid benchmark/discovery path when confidence is low.

`WIL-47` should initially be discovery or benchmark work rather than a guaranteed outcome, even though it is semantically possible.

#### Eligibility and cost estimation must be separate

The estimator produced plausible token costs for impossible outcomes. A numeric cost prediction does not imply that an outcome is contractable.

Build:

- a first-class `EligibilityAssessment`;
- semantic contradiction and controllability classification;
- hard policy gates before quote generation;
- distinct `accept`, `clarify`, `decompose`, and `decline` results;
- no executable quote for `WIL-44` or `WIL-43`;
- a bounded alternative proposal for tasks suitable for paid discovery.

#### Issue edits must invalidate commercial decisions

Linear descriptions and acceptance criteria are mutable. A comment saying “accepted” must not silently authorize a changed issue.

Build:

- normalized task-contract snapshots;
- deterministic contract hashes;
- quote expiry;
- explicit acceptance against quote ID and expected hash/price;
- invalidation when material issue content or repository SHA changes;
- idempotent acceptance and execution.

#### Linear is an adapter, not the source of truth

The benchmark demonstrated a useful agent workflow, but putting pricing authority in comments would be unsafe. Linear can supply task intent and display progress; the Outcomes control plane must own quotes, acceptance, execution state, verification, and payment authorization.

For the MVP, an agent with both Linear MCP and Outcomes MCP can orchestrate:

```text
Linear MCP: read issue
    -> Outcomes MCP: quote_task with normalized contract and external issue reference
    -> Linear MCP: post returned customer-safe quote summary
    -> human explicitly accepts through Outcomes
    -> Outcomes MCP: accept_quote_and_start
    -> Outcomes MCP: get_task_status
    -> Linear MCP: post terminal result
```

This avoids storing a Linear credential in the Outcomes backend for the first slice. A native Linear connector or webhook can come later.

The Outcomes schemas should nevertheless include optional external-source metadata:

- provider, such as `linear`;
- workspace/team;
- project ID;
- issue ID and URL;
- issue content/version hash;
- last synchronized timestamp.

#### Write-back must be idempotent

Retries, MCP reconnects, and status polling can otherwise create repeated comments.

Build:

- deterministic write-back keys per quote/task/event;
- a recognizable metadata marker in generated comments;
- persisted external comment IDs when a native connector is added;
- “post only on meaningful state transition” behavior;
- reconciliation that tolerates deleted or manually edited comments.

#### The backlog should become an evaluation dataset

The project is more valuable than a demo board. Each issue can become a labelled underwriting and execution example.

Record:

- expected eligibility and reason codes;
- classifier output and confidence;
- quote version and repository SHA;
- predicted cost distribution;
- selected runtime/model;
- actual usage and delivery cost;
- verification outcome;
- false acceptance/rejection;
- human override and reason;
- remediation or refund outcome.

Sync those labels to the control-plane database or fixture files. Do not try to learn directly from mutable Linear comments.

## What is not yet built

### No customer quote model

The current estimator predicts execution cost. It does not calculate the fixed price charged to a customer.

The control plane still needs to derive and persist:

- predicted execution and verification cost;
- risk/tail allowance;
- internal execution budget;
- target margin;
- payment fees;
- fixed customer quote;
- expiry, scope, conditions, estimator version, policy version, repository SHA, and contract hash.

Keep private underwriting details separate from the customer-safe quote response.

### No semantic eligibility classifier

The heuristic catches simple open-ended language but cannot reliably detect:

- contradictory requirements;
- outcomes controlled by customers, markets, or third parties;
- subjective or unverifiable success;
- hidden dependencies on credentials, capital, sales activity, or future decisions;
- tasks that should become paid discovery rather than guaranteed outcomes.

Do not use a Cursor coding agent as the classifier. Cursor agent startup and tool context are far too expensive for this job. Use a direct, tool-free small-model API with strict structured output.

Recommended classifier result:

```json
{
  "decision": "accept",
  "confidence": 0.95,
  "reasonCodes": ["priceable"],
  "summary": "The result is bounded and objectively verifiable.",
  "questions": [],
  "suggestedBoundedOutcome": null
}
```

The policy should combine deterministic gates with this semantic result:

```text
deterministic hard rejection always wins
semantic classification may restrict but never loosen a hard gate
low confidence or classifier failure fails closed to clarify/decompose
only an eligible final decision may produce an executable quote
only an accepted, unexpired quote may create a task
```

The classifier must judge contractability rather than difficulty. A large mechanical migration with objective tests can be eligible; a tiny request promising business revenue cannot.

The initial regression corpus should include at least 30 positive, negative, ambiguous, and prompt-injection cases. The contradictory calculator task and revenue task must never be accepted. Live model tests should be opt-in; normal tests should use a fake provider.

A direct model-provider credential and model choice are still required. `CURSOR_API_KEY` should remain dedicated to coding-agent execution.

### No product persistence or lifecycle

The JSONL ledger is useful for experiments but is not product persistence. The control plane needs immutable quotes, tasks, append-only task events, ownership checks, expiry, idempotency, and external worker identifiers in Supabase.

The current workflow waits synchronously for Cursor and then verifies. It must not be copied into a Vercel request. Product execution should:

1. validate and atomically accept the quote;
2. create the task and initial event;
3. launch Cursor Cloud;
4. persist `agent_id` and `run_id`;
5. return the Outcomes `task_id` immediately;
6. reconcile worker state and usage during later status requests;
7. verify terminal work separately;
8. settle only after verified success.

### No safe general verifier

`TaskRequest.verifierCommand` is trusted operator input in the spike. Exposing it to customers would be remote command execution.

For the first product slice, support only the known repository and a server-owned verifier profile with a fixed command and bounded environment. Later designs need a real sandbox or trusted CI integration before arbitrary repositories and commands are accepted.

### No enforcement of underwriting decisions

The spike can run estimates marked `decompose` or `decline`. The product must reject quote acceptance and execution unless the persisted final eligibility decision allows it.

### No MCP or REST product API

The spike is a local CLI. It does not implement the three planned product operations:

- `quote_task`
- `accept_quote_and_start`
- `get_task_status`

These should be implemented once as authenticated control-plane operations. REST handlers call those operations. Hosted MCP tools call the same operations through the API. MCP must not duplicate pricing, authorization, ownership, expiry, state-transition, verification, or billing logic.

## Important limitations to preserve

- Token and cost thresholds are soft because usage can arrive after a model turn finishes.
- Cancellation may overshoot by one in-flight turn.
- Cloud usage may only be available after completion through reconciliation.
- Cursor project hooks must be committed to the repository being executed.
- Cloud agents may perform early read-only exploration before repository hooks load.
- Arbitrary repositories do not inherit hooks from `build-attempt-1`.
- A Cursor `finished` status is not a verified outcome.
- A branch or PR is evidence of delivery, not evidence that acceptance criteria passed.
- Repository URL formats need canonicalization before matching returned Cursor branches. This was observed in practice: Cursor may return `github.com/owner/repo` while the manifest stores `https://github.com/owner/repo`; the spike currently falls back to the first returned branch, which is not safe enough for product verification.
- The current cost figures cover model execution, not verification infrastructure, payment fees, remediation, refunds, support, or failed-delivery losses.
- The rate card is versioned but must be refreshed and audited against actual billing.
- Historical calibration currently groups by broad task family and has almost no data. Do not present its probability or cost ranges as statistically calibrated.
- The current fixture repository is deliberately tiny. Results will not generalize automatically to production repositories.

## Recommended integration sequence

### 1. Preserve the research baseline

- Keep `build-attempt-1` as a runnable benchmark harness.
- Do not copy `node_modules`, `dist`, generated reports, or the CLI wholesale.
- Re-run `npm run check && npm test` before and after material kernel changes.
- Add future real runs to calibration data without treating the artifact directory as production state.

### 2. Port the pure pricing kernel

Port and test the useful pure modules behind server-only product interfaces:

- schemas and types;
- repository/task feature contracts;
- task analysis;
- estimator interface and heuristic;
- rate-card calculations.

Remove filesystem and CLI assumptions from the port. Keep all quote decisions tied to an exact repository identity and commit SHA.

### 3. Add eligibility before commercial pricing

- Introduce a separate `EligibilityAssessment`.
- Add deterministic hard gates and the semantic classifier.
- Version the classifier prompt, model, schema, and policy.
- Record rejected assessments as training/audit data.
- Do not produce a customer-facing execution quote for rejected work.
- Support `decompose` into a bounded paid-discovery outcome.

Do not continue overloading `TaskEstimate.decision`; estimation and eligibility should be related but separate concepts.

### 4. Derive immutable commercial quotes

- Produce private underwriting and public quote projections from one versioned decision.
- Include execution risk and failed-attempt economics, not only expected successful-run cost.
- Persist the authoritative cents values server-side.
- Hash the complete agreed contract.
- Require explicit acceptance with quote ID, expected contract hash or price, and idempotency key.

### 5. Adapt cloud execution asynchronously

- Use an Outcomes-owned Cursor credential.
- Restrict the first version to the pinned fixture repository.
- Launch and return immediately.
- Reattach by agent/run ID during `get_task_status`.
- Record usage, branches, terminal status, and failures as append-only events.
- Keep the worker adapter independent from quote and payment logic.

### 6. Add bounded verification and evidence

- Select a server-owned verifier profile from trusted configuration.
- Verify the exact resulting branch/commit.
- Return structured criterion-level evidence.
- Preserve command output, commit identity, and timing.
- Route worker failure, budget stop, and verification failure to distinct terminal states.

### 7. Expose stable adapters

- Implement authenticated REST endpoints first.
- Add hosted Streamable HTTP MCP as a thin adapter.
- Keep quote, acceptance/start, and status as separate operations.
- Add the CLI only after the HTTP contract stabilizes.

## Decisions the next agent should not reopen casually

- The Next.js control plane and Supabase are the product core.
- REST is canonical; MCP is an adapter.
- MCP never stores business authority or secrets.
- Quote acceptance is a separate commercial boundary.
- Execution is asynchronous.
- The MVP supports one configured GitHub repository at an exact SHA.
- The MVP uses Cursor Cloud, not a new worker platform.
- Verification is bounded and server-owned.
- JSONL remains a benchmark/calibration mechanism only.
- The browser does not run background work or authorize billing transitions.
- Worker completion does not trigger payment without verification.

## Decisions still required

- Which direct small-model provider and model will power semantic classification?
- What confidence threshold and fail-closed behavior should move a task to `clarify`, `decompose`, or `decline`?
- What formula converts the internal cost distribution and success probability into the customer quote?
- What initial target margin and tail-risk allowance should be used?
- Which exact verifier profile and evidence schema are sufficient for the first repository?
- How should status reconciliation be triggered after the demo: explicit polling only, scheduled refresh, or a later queue?
- What review/remediation window must pass before payment?
- Which Pinch settlement path is demonstrable and accurately described: payment after verification or cancellable scheduled payment?

## Suggested first vertical-slice acceptance test

Use the pinned calculator repository and expose the flow through the control plane:

```text
quote bounded zero-division fix
    -> persist immutable eligible quote
    -> accept with idempotency key
    -> return task ID immediately
    -> Cursor Cloud produces a branch
    -> bounded verifier runs the fixed test suite
    -> structured evidence marks success
    -> payment transition is authorized
```

Also demonstrate a negative path:

```text
quote contradictory or revenue-guarantee task
    -> eligibility rejects or decomposes it
    -> no executable quote
    -> no Cursor run
    -> no payment instruction
```

That pair proves the essential product claim more strongly than adding broad repository support or more UI.

## Handoff checklist

- Read the two control-plane plans before modifying product architecture.
- Treat `build-attempt-1` as evidence and source material, not deployable application code.
- Preserve and extend the current eight-test regression baseline.
- Keep secrets out of files and logs; document environment-variable names with placeholders only.
- Never expose `verifierCommand` or arbitrary repository shell execution to customers.
- Implement semantic eligibility before allowing public quote acceptance.
- Keep internal cost, customer price, execution budget, actual cost, and payment fee as separate fields.
- Record model, rate-card, estimator, classifier, policy, verifier, and contract versions.
- Make every lifecycle transition authenticated, owned, idempotent, and append-only.
- Test both verified success and no-charge failure paths end to end.
