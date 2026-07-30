# Outcomes

Outcomes gives coding agents a fixed-price task contract, runs the work, verifies
the result independently, and charges only after verified success.

## Install the hosted MCP

The Outcomes MCP is hosted. You do not need to clone this repository or install
an npm package to use it.

### 1. Create an Outcomes account

1. Open [outcomes-chi.vercel.app/sign-in](https://outcomes-chi.vercel.app/sign-in).
2. Enter an email and a password of at least eight characters.
3. Select **Create account**.
4. If prompted, confirm the email and sign in.
5. Complete the sandbox billing setup with a name and company.

Billing uses Pinch's test environment. No real card details are collected and no
real funds move.

### 2. Create an API key

1. Open the Outcomes dashboard.
2. In **Outcomes API keys**, give the key a descriptive name.
3. Select **Create key**.
4. Copy the complete `outcomes_test_...` value immediately. Outcomes displays
   it once and stores only its SHA-256 hash.

Treat this value as a password. Do not commit it or paste it into prompts.

### 3. Store the key

For a local agent or harness, set the key in its process environment:

```bash
export OUTCOMES_API_KEY="outcomes_test_your_key"
```

To keep it available after opening a new terminal, add the export to your shell
profile or use your preferred local secret manager. Never add the key to a
repository.

### 4. Connect an agent or harness

Outcomes works with any client that supports authenticated MCP over Streamable
HTTP. The connection contract is:

```text
Transport: Streamable HTTP
URL: https://outcomes-chi.vercel.app/api/mcp
Header: Authorization: Bearer <OUTCOMES_API_KEY>
Authentication: static bearer token
```

The server is stateless and exposes `quote_task`, `accept_quote_and_start`, and
`get_task_status`.

#### Cursor

Create `.cursor/mcp.json` in the project where you want to use Outcomes. To
make Outcomes available in every project, use `~/.cursor/mcp.json` instead.
Cursor merges both locations, with project configuration taking precedence when
server names overlap:

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

Restart Cursor after changing the environment or configuration. Open
**Customize → MCPs**, find `outcomes`, and confirm that it is enabled and
connected.

If the server reports `401 Unauthorized`, confirm that Cursor inherited
`OUTCOMES_API_KEY`, that the value includes the complete `outcomes_test_`
prefix, and that the key has not been revoked. For connection diagnostics, open
Cursor's Output panel with **Cmd+Shift+U** and select **MCP Logs**.

Remote MCP servers do not support Cursor's `envFile` setting. The key must be
available in Cursor's process environment. Cursor Cloud Agents use MCP
configuration from the Cloud Agents dashboard rather than relying on this local
`mcp.json`.

#### Other MCP clients and coding agents

In Claude, VS Code extensions, hosted coding agents, CI systems, or another MCP
host, add a **remote Streamable HTTP** server using the URL and authorization
header above. Configuration names and environment interpolation differ between
products, so do not assume Cursor's `${env:OUTCOMES_API_KEY}` syntax is
portable. Use that product's secret storage or environment-variable mechanism.

For a custom application or agent harness:

1. Use an official Model Context Protocol SDK for your language.
2. Create a Streamable HTTP client transport for the Outcomes URL.
3. Add the bearer header to every MCP request.
4. Initialize the MCP connection and discover tools with `tools/list`.
5. Call `quote_task`, present its exact price and contract to the user, and
   require explicit approval before calling `accept_quote_and_start`.
6. Poll `get_task_status` until the task reaches a terminal state.

For a hosted agent, store the key in the provider's secret manager and configure
the MCP server in that provider's dashboard or deployment settings. Do not send
the API key to the model as prompt text.

If an agent platform does not support remote MCP, use the equivalent REST
endpoints documented below. MCP and REST share the same authentication,
eligibility, idempotency, worker, verifier, and payment services.

### 5. Run the supported demo

This hackathon version deliberately fails closed. It accepts only the following
public fixture and bounded task:

```text
Repository: https://github.com/w-v-r/agent-cost-benchmark-fixture
Commit: 4aff18a256039f727b54d3cc48b65e8e8eab7bb7

Description:
Fix src/calculator.js so divide throws an Error when the divisor is zero.

Acceptance criteria:
- The existing zero-divisor test passes.
- Existing add and non-zero divide behavior remains unchanged.

Prohibited changes:
- Do not modify tests.
- Do not add dependencies.
- Do not change the exported function names.
```

Give an agent this prompt:

```text
Use the Outcomes MCP to quote the supported calculator zero-division task from
the project README. Show me the fixed price and ask for approval before
accepting it. After I approve, start the task and poll its status until it
reaches a terminal state. Report the worker branch or pull request,
verification result, and sandbox payment status.
```

The expected lifecycle is:

```text
quote → explicit approval → Cursor Cloud worker → trusted GitHub verification
      → Pinch sandbox charge → completed
```

Quote creation does not start work or submit a payment. The agent must present
the quote and receive explicit approval before calling
`accept_quote_and_start`.

## What is live

- Customer signup, sandbox billing onboarding, and API-key management
- Authenticated Streamable HTTP MCP and REST endpoints
- Immutable, expiring, idempotent fixed-price quotes
- Atomic quote acceptance and asynchronous Cursor Cloud execution
- Trusted GitHub Actions verification against the quoted repository SHA
- Exactly-once Pinch sandbox charging after verified success
- Task status reconciliation across worker, verifier, and payment states

The current quote is AUD 12.50 in sandbox mode. Outcomes rejects other
repositories, commits, and task contracts; this is an intentional MVP safety
boundary rather than a general coding-agent service.

## REST API

MCP is the recommended agent integration. The same lifecycle is available over
REST:

```text
POST /api/v1/quotes
POST /api/v1/quotes/:quoteId/accept
GET  /api/v1/tasks/:taskId
```

Send the API key with every request:

```text
Authorization: Bearer outcomes_test_<prefix>_<secret>
```

Request schemas, idempotency rules, and examples are documented in
[CONTROL_PLANE_API.md](./CONTROL_PLANE_API.md).

## Security and payment behavior

- API-key secrets are shown once and persisted only as SHA-256 hashes.
- Every quote, task, event, and payment is bound to the authenticated customer.
- Reusing the same idempotency key with the same request returns the original
  resource; changing the request produces a conflict.
- A worker reporting success is not enough to charge. The trusted verifier must
  pass first.
- Pinch payment nonces and database uniqueness constraints prevent duplicate
  charges during retries and repeated status polling.
- The deployed integration is sandbox-only. It does not move real money.

Revoke a key from the dashboard immediately if it is exposed.

## Local development

This section is for contributors building Outcomes itself. MCP customers only
need the installation steps above.

Requirements:

- Node.js 24
- A Supabase project
- Pinch sandbox credentials
- An Outcomes-owned Cursor API key
- A GitHub token with Actions access
- An Outcomes GitHub App for private-repository execution

Install and verify:

```bash
npm install
cp .env.example .env.local
npm run test
npm run lint
npm run typecheck
npm run build
```

Apply the Supabase migrations, populate `.env.local`, then start the app:

```bash
npx supabase db push
npm run dev
```

See [.env.example](./.env.example) for required server variables. Never expose
`SUPABASE_SECRET_KEY`, Pinch secrets, `CURSOR_API_KEY`, or
GitHub tokens, app secrets, and private keys to the browser.

### Outcomes GitHub App

Register one GitHub App owned by Outcomes with:

- Callback URL: `<NEXT_PUBLIC_APP_URL>/api/github/callback`
- Request user authorization during installation: enabled
- Repository permissions:
  - Contents: read and write
  - Pull requests: read and write
- Installation scope: any account, with customers encouraged to select only
  the repositories they want Outcomes to use

Do not configure a Setup URL when OAuth during installation is enabled. Set the
six `OUTCOMES_GITHUB_APP_*` variables from [.env.example](./.env.example), then
open the dashboard and select **Install GitHub App**. The callback verifies the
installation against the authorizing GitHub user before persisting it; the
untrusted `installation_id` query parameter is never accepted on its own.

The worker spike mints repository-scoped installation tokens for at most one
hour and revokes each token after clone or publication. The local Cursor agent
runs in a separate process with a fresh home directory, an explicit sandbox,
no ambient settings, no Git metadata, and no GitHub credential. A publisher
outside the agent validates the allowlisted diff, creates the commit and
branch, opens the PR, and checks exact base/head ancestry and changed-file
scope.

Run the read-only repository and pinned-ref preflight first:

```bash
npm run github-app:worker:smoke -- \
  --installation-id 12345678 \
  --repository https://github.com/owner/repository \
  --base main \
  --sha 0123456789abcdef0123456789abcdef01234567
```

The guarded write spike also requires a reviewed prompt, one or more explicit
publication paths, and an exact normalized repository confirmation:

```bash
npm run github-app:worker:smoke -- \
  --installation-id 12345678 \
  --repository https://github.com/owner/repository \
  --base main \
  --sha 0123456789abcdef0123456789abcdef01234567 \
  --allow-path README.md \
  --prompt-file ./path/to/reviewed-probe-prompt.txt \
  --execute \
  --confirm-write https://github.com/owner/repository
```

This spike does not create a quote, accept a task, widen repository eligibility,
or call Pinch.

### Cursor repository access smoke test

Check whether the configured Cursor identity can see a repository without
starting an agent:

```bash
npm run cursor:repository:smoke -- \
  --repository https://github.com/owner/repository
```

The command exits with code `2` when GitHub is not connected or the repository
is not in Cursor's connected-repository catalog. Catalog visibility does not
prove clone, push, or PR permission. To exercise Cursor's write path, use a
repository prepared for a harmless bounded change and opt into the write probe
explicitly:

```bash
npm run cursor:repository:smoke -- \
  --repository https://github.com/owner/repository \
  --sha 0123456789abcdef0123456789abcdef01234567 \
  --execute \
  --confirm-write https://github.com/owner/repository \
  --prompt-file ./path/to/reviewed-probe-prompt.txt
```

The write probe talks directly to Cursor Cloud. It does not create an Outcomes
quote, accept a task, or call Pinch. Success requires a terminal Cursor run with
both a result branch and a PR URL. Before treating the result as exact-SHA
evidence, independently verify the PR base, head ancestry, and changed-file
scope through GitHub.

## Project documentation

- [Control-plane API](./CONTROL_PLANE_API.md)
- [Implementation plan](./OUTCOMES_IMPLEMENTATION_PLAN.md)
- [Developer workflow plan](./DEVELOPER_WORKFLOW_IMPLEMENTATION_PLAN.md)
- [Completion and learnings](./OUTCOMES_COMPLETION_AND_LEARNINGS_TRACKING.md)
- [Known issues](./known-bugs-to-fix.md)

