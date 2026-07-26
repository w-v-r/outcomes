I scoped the full integration in an interactive architecture canvas: Pinch Payments integration scope. A canvas is a standalone visual plan you can open beside this chat.

Key conclusion: your model is broadly correct, with one important distinction:

A Pinch Payer is the customer record.
A Pinch Source is the reusable payment method.
Creating a Payer alone does not authorize future charges.
For cards, your app must record approval of the exact quote; Pinch does not create a card payment agreement.
Recommended sandbox flow:

confirm account
→ collect first name, last name, optional company
→ create Pinch sandbox Payer
→ use CaptureJS with Pinch’s standard test Visa
→ create durable sandbox Source
→ mark billing setup complete
→ enter dashboard
The user would see no card fields yet. Suggested messaging:

Pinch Payments is running in test mode. We’ll create a sandbox billing profile and attach a standard Pinch test card. No real card details will be collected and no real funds will be charged.

Charging flow:

pricing model produces amount
→ persist immutable quote in cents
→ customer explicitly approves exact amount and charging terms
→ execute and verify task
→ reserve one local payment using deterministic nonce
→ charge stored Source through /payments/realtime
→ save synchronous result
→ reconcile signed webhook events through settlement/failure
Important implementation choices:

Onboarding happens after account confirmation—not after every sign-in.
Existing users are redirected there only if billing setup is incomplete.
Charge only after verified completion, not merely worker completion.
Charge the persisted quote amount; never rerun pricing at payment time.
Absorb Pinch fees initially so the charged amount exactly matches approval.
Store only Pinch IDs and masked card data—never card number, CVC, or CaptureJS tokens.
A dummy completion trigger should call the same billing service future workers will use.
Duplicate task-completion events must still produce exactly one payment.
The current app only has Supabase authentication and a dashboard shell, so this also requires the first profile, billing, quote, task, payment, and webhook tables.

I also found several Pinch documentation inconsistencies—source endpoint path, payer field names, token field names, and nonce shape. The first implementation step should therefore be a small sandbox contract test before building domain logic.

Primary references: core concepts, vaulting a payment source, CaptureJS, test mode, nonces, and webhooks.

No application code was changed.

No follow-up needed; the architecture findings align with the completed scope.






