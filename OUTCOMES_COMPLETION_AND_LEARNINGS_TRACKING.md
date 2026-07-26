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
- Extract `chargeVerifiedTask(taskId)` from the dashboard Server Action.
- Make the dashboard and future MCP worker use the same charging service.
- Add automated rejected-payment, timeout, concurrent-completion, duplicate
  execution, and cross-user RLS tests.
- Define live-mode compliance, operational alerting, refund, and settlement
  procedures before enabling real funds.

