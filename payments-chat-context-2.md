The normal sandbox path is confirmed:

Supabase stores the Pinch Payer, Source, payment, quote, and task IDs.
The persisted AUD 12.50 quote was charged through Pinch.
Pinch returned approved, and Supabase recorded the matching payment.
Duplicate protection exists through database uniqueness and Pinch nonce checks.
The Pinch client is hard-locked to the test API.
However, it is not fully worker-ready yet:

Charging logic is currently coupled to a dashboard Server Action, not a reusable worker/MCP billing service.
Webhook code exists, but webhook secrets, Supabase admin credentials, public registration, and delivery testing are incomplete.
There is no periodic reconciliation for missed webhooks.
Failure, concurrent-completion, retry, cross-user RLS, and rejected-payment paths have not been fully tested.
Recommended next phase:

Extract a reusable chargeVerifiedTask(taskId) service.
Make both the demo and future MCP worker call that service.
Configure and test Pinch webhooks end-to-end.
Add automated sandbox tests for duplicate execution, timeout recovery, failed payments, RLS isolation, and reconciliation.
So: the happy-path proof is strong, but more implementation and testing are required before claiming reliable MCP-triggered billing.