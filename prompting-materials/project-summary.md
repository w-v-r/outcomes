# LLMs by the Outcome

## One-line pitch

AI agents currently charge customers for attempting work. **LLMs by the Outcome** quotes a fixed price for a verified result, executes the work efficiently, and uses Pinch to collect, cancel, or refund payment according to an auditable outcome contract.

## The idea

“Netflix by the second” asks what happens when an existing product is sold in a radically different unit. **LLMs by the Outcome** applies the same idea to AI: instead of selling tokens, sell completed tasks.

The important change is not merely the billing unit. It changes the incentive:

- A token provider earns more when a model consumes more.
- An outcome provider earns more when it completes the task reliably and efficiently.

The project is middleware between customers and model providers. Tokens remain the underlying commodity, but the middleware packages them into priced, guaranteed units of useful work.

## Project thesis

The current LLM market charges per token. That creates a structural incentive for providers to sell more token consumption rather than to complete work efficiently or successfully. Customers receive uncertain bills and bear the risk when an agent loops, fails, or consumes far more compute than expected.

This project introduces a middleware layer that sells the valuable unit the customer actually wants: **a completed task or verified outcome**.

> Cursor does the work. Our system prices and verifies the outcome. Pinch moves the money according to the result.

The middleware estimates the likely execution cost and probability of success, offers a fixed outcome price where the risk is acceptable, chooses a cost-effective execution strategy, and earns the difference between the customer price and the actual cost.

The platform owns the task quote. Pinch does not decide what an outcome is worth; it calculates the payment-processing fee for the selected payment method and executes the resulting financial instruction.

The commercial loop is:

1. estimate what the task will cost;
2. decide whether the outcome can be responsibly guaranteed;
3. quote the customer a fixed price;
4. deliver and verify the outcome;
5. collect payment through Pinch;
6. retain the difference between the charge and total delivery cost as profit.

## Why it matters

- Customers know the price before execution.
- Customers do not directly absorb unpredictable token usage.
- The provider is rewarded for efficiency, routing, and successful completion.
- Tasks—not tokens—can become the commercial unit.
- Historical task data improves future pricing and creates a defensible underwriting advantage.

## Core concepts

### Outcome contract

Before execution, the customer agrees to an immutable contract containing:

- the promised target state;
- the fixed price;
- objective verification and acceptance tests;
- constraints and exclusions;
- the review period;
- remediation and dispute rules;
- a contract/version hash.

Success is judged against this contract, not against abstract customer satisfaction.

### Underwriting

The system makes two decisions:

1. **Eligibility:** can this task be responsibly guaranteed?
2. **Pricing:** what price compensates for expected execution cost and risk?

Important signals include scope, verifiability, controllability, uncertainty, dependencies, novelty, success probability, and tail-cost risk.

The system may:

- accept and quote the task;
- accept it with conditions or exclusions;
- decline to quote;
- decompose it into a paid diagnostic outcome followed by a separately priced implementation.

Refusing to quote is a feature. The product should not promise outcomes it cannot responsibly underwrite.

Because execution costs are incurred even when an outcome fails, while the customer may only pay after success, the collected price must compensate for both cost and risk. A conceptual price floor is:

\[
\text{Minimum collected price} \approx
\frac{
E[\text{execution cost}] +
E[\text{claim and refund loss}] +
\text{overhead} +
\text{target profit}
}{
P(\text{verified success}) \times
P(\text{successful collection})
}
\]

Pinch processing fees are then absorbed into this price or shown as a transparent surcharge.

### Product modes

| Product | Payment trigger | Best suited to |
| --- | --- | --- |
| Guaranteed Outcome | Verifier confirms the target state | Narrow, objectively testable tasks |
| Fixed-Price Delivery | Work is delivered within an agreed scope | Tasks with some subjective judgment |
| Paid Discovery | Diagnosis and evidence are delivered | Work too uncertain to price upfront |

A useful hybrid is a non-refundable discovery fee plus a verified success fee.

### Verification and disputes

The customer should see **Report a problem**, not **Mark failed**. A report pauses settlement and opens a claim; it does not unilaterally cancel payment.

A claim should identify the failed acceptance criterion and include reproduction steps and relevant evidence. The system then:

1. freezes settlement;
2. reruns the original verifier against the agreed commit and environment;
3. checks whether the complaint is in scope;
4. allows a bounded remediation period;
5. uses independent technical review for ambiguous cases;
6. pays, refunds, or partially settles based on evidence.

Branches, execution traces, repository state, and test output should be preserved as evidence. Delivered code cannot reliably be “taken back.”

## Pinch Payments integration

Pinch is the settlement engine for the outcome contract, not the outcome-pricing engine and not an incidental checkout button.

### Pricing boundary

The platform produces the **outcome quote** from task scope, expected model cost, success probability, uncertainty, and target margin.

Immediately before checkout, Pinch’s `POST /calculate-fees` supplies the exact **payment fee** for the quoted amount and chosen payment source. The customer can then see:

- outcome price;
- Pinch processing fee, if passed through;
- total charge;
- the conditions that trigger payment.

Pinch fee calculation informs the final checkout total, but Pinch does not price the work.

The integration should demonstrate:

1. **CaptureJS** for payment-detail tokenisation.
2. A reusable **Payer** and payment **Source**.
3. A direct-debit **Agreement** where appropriate.
4. `POST /calculate-fees` during quoting.
5. Realtime or scheduled outcome payments.
6. Deterministic nonces for idempotency.
7. Signed webhooks driving the payment state machine.
8. Cancellation before a scheduled payment is processed.
9. Full or partial refunds after settlement.
10. Transfer reconciliation and chargeback events.

A scheduled payment is not escrow and does not reserve funds. For the MVP:

- card payments should be created after verified success and review;
- direct-debit collection can be scheduled after verified success;
- expensive or uncertain work should begin with a separately priced diagnostic phase.

For a visually stronger hackathon path, the system may create a future scheduled payment when the customer accepts the contract and delete it if verification fails. This clearly demonstrates programmable settlement, but it should be described as a scheduled payment—not escrow—and the cancellation cutoff must be confirmed with Pinch.

The platform database remains the source of truth for outcome contracts and execution. Pinch remains the source of truth for payment attempts, processing, refunds, disputes, and settlement. Shared identifiers in Pinch metadata link the two systems.

## Hackathon demo

Use a small, objectively verifiable coding task:

> Make this failing test pass without modifying the test or public API.

### Comparison view

Run or model the same task three ways:

- Model X at raw token cost;
- Model Y at raw token cost;
- the middleware using cost-optimised model routing.

Show:

- each provider’s execution cost;
- the fixed customer outcome price;
- the middleware’s actual cost;
- gross profit: customer charge minus execution and payment costs.

This makes the incentive difference visible: token providers profit from consumption; the middleware profits from efficient completion.

The key numbers on screen should be:

- raw token cost for each model;
- the middleware’s chosen route and actual cost;
- the fixed outcome price shown before execution;
- the Pinch processing fee;
- gross profit: outcome price minus execution and payment costs.

### Successful path

1. Inspect the repository and scope the task.
2. Quote a guaranteed outcome price with Pinch fees included.
3. Customer accepts the outcome contract and payment terms.
4. Cursor Cloud Agent performs the work.
5. Tests and contract constraints pass.
6. Display an evidence bundle.
7. Complete the review window.
8. Pinch processes payment.
9. Webhooks move the dashboard from `Paid` to `Settled`.

### Failure path

1. Attempt an impossible or constraint-breaking task.
2. The verifier rejects the result.
3. No payment is created, or a scheduled payment is deleted.
4. Display: `Outcome not delivered — customer not charged`.

If time permits, demonstrate **Report a problem** pausing settlement and opening the evidence-review workflow.

## Presentation narrative

1. Introduce Will and the inspiration: “Netflix by the second.”
2. Reveal the new unit: “LLMs by the Outcome.”
3. Show the problem: pay-per-token produces uncertain bills and rewards token-hungry systems.
4. Repeat the central idea: **incentives, incentives, incentives**.
5. Introduce the middleware: customers buy a task at a known price; the platform assumes execution risk.
6. Show Model X, Model Y, and the cost-optimised middleware completing the same work in parallel.
7. Reveal the business model: customer charge minus execution and Pinch costs equals gross profit.
8. Demonstrate successful and failed outcomes, with verification controlling Pinch settlement.
9. Explain the compounding advantage: every task improves future eligibility, pricing, and routing.
10. End with the larger market: once tasks can be reliably priced, they can support arbitrage, underwriting, insurance, and a marketplace.

Underwriting, arbitrage, and insurance should be presented as consequences of the core product—not separate ideas forced into the demo. The first proof is simply that the platform can quote, execute, verify, and settle one task better than pay-per-token access.

## Enterprise extension

Linear issues and sub-issues can become priced work units. The system can quote each bounded subtask, aggregate those prices into the cost of moving a parent ticket to review, and let an enterprise approve known costs before execution rather than discovering token spend afterwards.

## Defensibility and long-term opportunity

Every quote and execution generates data about:

- expected versus actual cost;
- success rates by task family and model;
- false acceptances and false rejections;
- cost overruns and tail risk;
- dispute and refund frequency;
- which diagnostic steps make uncertain work priceable.

Over time, the system learns its own capability frontier: which outcomes it can safely guarantee, how to route them cheaply, and when it should refuse. This pricing and risk data can support:

- model and provider arbitrage;
- outcome underwriting;
- AI performance insurance;
- enterprise task budgeting;
- a marketplace of third-party outcome providers.

## Important open questions

- Which objective verifiers are credible enough to trigger payment?
- What review window and remediation policy best balance customer trust and fraud risk?
- Does Pinch support card authorisation with delayed/manual capture?
- What is the cutoff for changing or deleting scheduled payments?
- Which fees are returned after a refund?
- Can the sandbox simulate dishonours, refunds, chargebacks, and transfers?
- Can Managed Merchants support marketplace fees or split economics?
- Should the platform or each outcome provider be the merchant of record?

## Naming

- **LLMs by the Outcome** is the broad project, presentation hook, and market thesis.
- **Outcomes** is the working product name for the verification-and-settlement workflow.
- **Task** can be used as the practical unit inside the product, while **outcome** remains the stronger commercial promise.
