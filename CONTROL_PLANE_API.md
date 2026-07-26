# Outcomes control-plane API

The hackathon slice supports one private fixture repository, one pinned commit,
and one bounded zero-division task. All other repository and task shapes fail
closed.

## Authentication

Create a key in the authenticated Outcomes dashboard. The complete value is
shown once and stored only as a SHA-256 hash.

Send it to REST and MCP as:

```text
Authorization: Bearer outcomes_test_<prefix>_<secret>
```

## REST lifecycle

1. `POST /api/v1/quotes` creates or replays an immutable quote.
2. `POST /api/v1/quotes/:quoteId/accept` atomically accepts the exact contract
   hash, creates one task, starts one Cursor Cloud run, and returns `202`.
3. `GET /api/v1/tasks/:taskId` reconciles worker, verifier, and Pinch sandbox
   payment state.

Quote request:

```json
{
  "idempotency_key": "customer-request-001",
  "repository_url": "https://github.com/w-v-r/agent-cost-benchmark-fixture",
  "repository_sha": "4aff18a256039f727b54d3cc48b65e8e8eab7bb7",
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

Acceptance request:

```json
{
  "contract_hash": "<hash returned by the quote>",
  "idempotency_key": "customer-acceptance-001"
}
```

Never change an idempotency key's request body. Reuse returns the original
resource; changed input returns a conflict.

## Cursor MCP configuration

Set `OUTCOMES_API_KEY` in the environment and avoid committing it:

```json
{
  "mcpServers": {
    "outcomes": {
      "url": "https://outcomes-chi.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer ${env:OUTCOMES_API_KEY}"
      }
    }
  }
}
```

The MCP exposes only:

- `quote_task`
- `accept_quote_and_start`
- `get_task_status`

MCP is a thin adapter. REST/application services remain authoritative for
eligibility, pricing, ownership, lifecycle, verification, and payment.

## Server environment

- `CURSOR_API_KEY`
- `OUTCOMES_CURSOR_MODEL`
- `OUTCOMES_GITHUB_TOKEN`
- Supabase variables from `.env.example`
- Pinch sandbox variables from `.env.example`

`OUTCOMES_GITHUB_TOKEN` needs Actions read/write access. Installing or changing
the trusted workflow with GitHub CLI also requires OAuth `workflow` scope.
