Yes. The core idea is strong, but the prompt currently explains the business more clearly than it specifies the website. A coding agent could produce something attractive while still making several important decisions arbitrarily.

The main weaknesses are:

* The intended visitor is unclear: individual developers, engineering leaders, enterprises, investors, or hackathon judges.
* It begins by requesting a customer application, then narrows the scope to a landing page. That creates ambiguity.
* “Task,” “agent request,” and “outcome” are used somewhat interchangeably. The page needs one dominant customer-facing concept.
* The pricing explanation is internally focused. Customers care about predictable prices per task; the arbitrage and margin model is primarily for judges and investors.
* There is no specific conversion goal or primary CTA.
* It doesn’t define the sections, information hierarchy, or minimum content the page needs.
* “Capture the spirit” and “lean on Ramp” leave too much visual judgment unconstrained.
* The Escher reference should be treated as conceptual inspiration—not copied artwork. You should describe what you want extracted from it: recursion, hands creating work, human/agent collaboration, impossible geometry, etc.
* It doesn’t specify implementation expectations: responsive design, accessibility, animation, reusable components, routes, placeholders, and whether the result must actually run.
* It doesn’t tell the agent to inspect the existing repository before changing anything.
* It references design skills without saying how to select or evaluate them.
* It doesn’t explicitly distinguish what exists now from the future vision. That could make the page misleading.

I would rewrite it like this:

---

# Build the landing page for my hackathon project

I want you to design and implement the public landing page for my hackathon project.

This will eventually become a combined marketing site and customer application in a single Next.js app. Customers will later be able to sign in, access API keys, submit or inspect tasks, and view their usage and charges.

For this task, however, build only the public landing page. Do not build the authenticated customer portal yet. You may structure the application so those product routes can be added cleanly later.

## Product concept

The product is currently a commercial wrapper around Cursor agents.

Instead of charging customers for tokens or raw model usage, we price the work at the level customers actually understand: the task.

Customers make an agent request and know the task price before the work begins. This gives individuals and engineering teams more predictable costs and protects them from unexpectedly expensive agent runs.

The deeper business model is task—or outcome—arbitrage:

* Estimate what the task would otherwise cost the customer to complete.
* Complete it using the most economical agent strategy capable of achieving the required result.
* Charge a task price below the customer’s counterfactual cost but above our execution cost.
* Retain the difference as gross profit.

The central product idea is:

> We price the work, not the tokens.

This must be the conceptual centre of the page. The customer-facing message should emphasize predictable task pricing and completed work. The arbitrage model can appear more subtly as the economic engine or long-term vision; do not make the landing page feel like an investor memo.

Be precise about the current product. Do not claim capabilities that are only part of the future vision.

## Audience and objective

The primary audience is developers and engineering teams already using coding agents who are concerned about variable, difficult-to-predict usage costs.

A secondary audience is the hackathon judges, who should be able to understand both the immediate customer value and the larger business model.

The primary conversion goal is to get visitors to request early access or try the product.

Use one clear primary CTA throughout the page. If the product is not yet usable, use “Request early access” rather than implying that it is publicly available.

## Page narrative

The page should communicate the idea in roughly this order:

1. A strong hero that immediately explains predictable, per-task pricing.
2. The problem with token-based pricing: the customer cannot reliably know the final cost.
3. How the product works: request a task, see its price, let the agent complete it.
4. A clear comparison between token pricing and task pricing.
5. An example showing how a task can have a known customer price even when its underlying token usage varies.
6. The broader vision: software work becoming an underwritten outcome rather than metered model consumption.
7. A final CTA.

You can improve this structure if the source material suggests a better narrative, but the finished page must make the product understandable within the first screen and the pricing mechanism understandable without reading the entire page.

## Visual direction

Use [Ramp](https://ramp.com/) as a reference for the level of craft and overall sensibility:

* restrained fintech aesthetic
* crisp typography
* strong spacing and hierarchy
* subtle mathematical or economic motifs
* confident use of black, white, neutral tones, and a limited accent palette
* polished product-oriented motion
* dense enough to feel substantive, but never cluttered

Do not recreate Ramp’s page, layout, components, copy, or brand identity. Translate the qualities of its design into an original visual system appropriate for this product.

The attached M.C. Escher references are conceptual inspiration. Do not reproduce the artworks. Draw from ideas such as:

* a system producing or completing its own work
* recursive creation
* human and machine collaboration
* work passing between agents
* hands, tools, tasks, and outputs forming a continuous system
* precise linework and impossible or self-referential geometry

Use these ideas to create an original hero treatment. It should feel purposeful and integrated with the product story—not like decorative AI-generated art pasted beside the headline.

Prefer a code-native visual built with HTML, CSS, SVG, or canvas if that will produce a sharper and more responsive result.

## Source material

Before designing the page, inspect:

* `@project-summary.md`
* `@hackathon-presentation-scipt-notes.md`
* `@design-skills.md`
* the files in `@image-references/`
* the existing Next.js project structure and styles

Use the project summary and presentation notes to understand the product. Do not dump all of their content onto the page.

Review `@design-skills.md` and use only the guidance directly relevant to landing-page design, typography, layout, interaction, and visual polish. Avoid pulling in unnecessary techniques simply because they are available.

If the filename `hackathon-presentation-scipt-notes.md` is a typo, locate the closest matching file before proceeding.

## Implementation expectations

* Work within the existing Next.js application and follow its established conventions.
* Build a complete, functional landing page—not merely a mock-up or design description.
* Use reusable components with a clean structure that can support a future authenticated portal.
* Make the page excellent on desktop and mobile.
* Use semantic HTML and meet sensible accessibility standards.
* Keep animations restrained, smooth, and respectful of reduced-motion preferences.
* Avoid generic startup imagery, excessive gradients, glowing blobs, stock illustrations, and empty dashboard mock-ups.
* Do not add dependencies unless they materially improve the result.
* Do not build authentication, API-key management, billing, or portal functionality in this phase.
* Ensure the project builds and the page can be run locally without errors.

## Design standard

This is a AU$50,000 hackathon entry. The page should feel like a credible, unusually well-designed product—not a generic hackathon template.

Make strong design decisions where the references provide enough direction. If a missing detail would materially affect the product positioning or page architecture, ask me; otherwise, use your judgment and proceed.

Before considering the task complete:

* verify the production build
* inspect the page at desktop and mobile sizes
* fix obvious layout, typography, contrast, overflow, and interaction problems
* briefly explain the final creative direction and any important assumptions

---

One strategic change I would make beyond the prompt: choose the exact primary phrase before implementation.

“Pay per agent request” is concrete, but it can accidentally mean “every prompt costs money,” even if the request fails. “Pay per task” is more valuable, but creates an expectation that the task has been completed or verified. “Pay for completed work” is strongest commercially, but makes the hardest promise.

Given where your concept currently sits, I would anchor the page around:

> Predictable prices for agent work.

Then use:

> Price the task, not the tokens.

as the memorable mechanism. That leaves room to evolve from request pricing toward genuinely verified outcome pricing without making the first version conceptually dishonest.
