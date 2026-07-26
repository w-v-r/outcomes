# Repository Cost and Runner Spike

This TypeScript CLI tests whether inexpensive repository and task features can predict a bounded Cursor agent execution. It works with no historical data, records every completed run for later calibration, and keeps pricing, execution, verification, and reporting separate.

## What is implemented

- Local checkout and pinned GitHub repository sources
- Deterministic repository manifest and task working-set analysis
- Replaceable `CostEstimator` with a conservative zero-history heuristic
- Versioned Composer 2.5 rate card
- Local and cloud Cursor SDK runners
- End-of-turn token accounting, Cloud Usage API reconciliation, and billed/estimated model cost
- Wall-clock, tool-call, token, and cost cancellation policies
- Project hooks for oversized reads, tool-call limits, and disabled subagents
- Isolated local working copies
- Independent verifier command
- Append-only JSONL execution ledger
- JSON and Markdown benchmark reports
- Successful, impossible, oversized-context, and misleading-scope fixtures

## Setup

```bash
npm install
npm run check
npm test
```

Agent execution requires a Cursor API key:

```bash
export CURSOR_API_KEY="cursor_..."
```

Use `Cursor.models.list()` or the Cursor dashboard to confirm that the fixed model and parameters in `config/rate-card.json` are available to the account. The rate card explicitly selects Composer 2.5 standard (`fast=false`); omitting this parameter selects the substantially more expensive fast variant. The included rates were copied from the linked Cursor pricing documentation on the rate card’s effective date. Subscription accounting may differ.

## Commands

Analyze and estimate without calling a model:

```bash
npm run cli -- estimate \
  --repo fixtures/sample-repo \
  --task-file fixtures/success-task.json \
  --output artifacts/estimate.json
```

Run an isolated local agent:

```bash
npm run cli -- run \
  --runtime local \
  --repo fixtures/sample-repo \
  --task-file fixtures/success-task.json \
  --ledger artifacts/runs.jsonl \
  --output artifacts/local-run.json
```

Run against a GitHub repository with a cloud agent:

```bash
npm run cli -- run \
  --runtime cloud \
  --github-url https://github.com/OWNER/REPOSITORY \
  --ref COMMIT_OR_BRANCH \
  --task-file fixtures/success-task.json
```

Execute the local/cloud comparison matrix:

```bash
npm run cli -- benchmark \
  --github-url https://github.com/OWNER/REPOSITORY \
  --ref COMMIT_OR_BRANCH \
  --tasks-file fixtures/tasks.json \
  --runtimes local,cloud
```

Preview the matrix without credentials or model calls:

```bash
npm run cli -- benchmark \
  --repo fixtures/sample-repo \
  --tasks-file fixtures/tasks.json \
  --runtimes local,cloud \
  --dry-run
```

## Repository and runtime model

GitHub is required only for cloud runs. Local analysis and local execution accept any filesystem checkout. A cloud benchmark clones the GitHub source for deterministic preflight/local execution, then asks the cloud runner to start from the same commit. Every quote is tied to the observed commit SHA where one exists.

Local execution uses an isolated temporary copy, so the source checkout is not modified. Cloud verification checks out the branch returned by the Cursor run before invoking the verifier. If the cloud run returns no accessible branch, the record correctly contains no independent verification result.

`fixtures/sample-repo` is the self-contained benchmark target. It has a deliberately failing test, no external dependencies, repository-local hooks, and task definitions in `fixtures/tasks.json`. Publish that directory as its own GitHub repository to compare local and cloud execution without exposing the pricing harness as irrelevant agent context.

The fixture is published privately at `https://github.com/w-v-r/agent-cost-benchmark-fixture`; the initial baseline commit is `20671f01638d8df245f2a2cc2fed7d3e914829fd`.

Generate a combined report from existing route-specific ledgers:

```bash
npm run cli -- report \
  --ledgers artifacts/sample-runs.jsonl,artifacts/cloud-runs.jsonl \
  --latest-per-runtime \
  --report-json artifacts/reality-benchmark.json \
  --report-markdown artifacts/reality-benchmark.md
```

## Guardrail guarantees

| Control | Strength | Limitation |
| --- | --- | --- |
| Isolated local checkout | Hard | Cloud isolation is managed by Cursor |
| Oversized read hook | Hard after hooks load | Cloud may explore read-only before project hooks load |
| Subagent hook | Hard after hooks load | Same cloud startup limitation |
| Tool-call hook counter | Hard after hooks load | Counter is hook/session scoped |
| Wall-clock cancellation | Reactive | In-flight work may take time to cancel |
| Token/cost cancellation | Soft | Usage arrives at turn completion; one turn can overshoot |
| Cloud token/cost limit | Observational when usage events are absent | The runner reconciles billed usage after completion through Cursor’s Usage API |
| Account spend limit | External circuit breaker | Not a per-task budget |

The project hooks live in `.cursor/` and must be committed into the repository a cloud agent executes. Arbitrary target repositories do not inherit this wrapper repository’s project hooks.

## Data evolution

The system does not require history. `HeuristicCostEstimator` uses task clarity, boundedness, verifiability, likely working-set size, package structure, tests, and oversized files. Every run records the estimator version, prediction, actual usage, outcome, verifier evidence, and error.

Future learned estimators can implement `CostEstimator` and consume the existing ledger. The current interfaces leave room for similarity retrieval, quantile cost models, calibrated success probabilities, and underwriting rules without coupling those future systems to repository access or agent execution.

## Security note

Verifier commands and repository inputs are trusted operator configuration in this spike. Do not expose them directly to untrusted users without command allowlisting, credential isolation, path validation, and stronger sandbox policy.
