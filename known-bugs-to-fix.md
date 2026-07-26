# Known bugs to fix

This document records reproducible defects and external integration problems
that need follow-up. Keep expected behavior, observed evidence, attempted fixes,
workarounds, and acceptance criteria together so an issue can be resumed without
repeating the investigation.

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

## Related follow-ups that are not confirmed bugs

- Extract a reusable `chargeVerifiedTask(taskId)` service for the dashboard and
  future MCP worker.
- Add scheduled Events API or Payments API reconciliation.
- Add rejected-payment, timeout, concurrency, duplicate-execution, and RLS
  isolation tests.
- Define monitoring and alerting for webhook failures before live mode.
