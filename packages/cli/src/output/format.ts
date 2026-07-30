import {
  isSnapshotQuote,
  type CustomerQuote,
  type CustomerTask,
} from "@outcomes/contracts";

export type OutputMode = "human" | "json";

export const formatCurrencyAud = (amountCents: number) =>
  `$${(amountCents / 100).toFixed(2)} AUD`;

export const writeJson = (value: unknown) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

export type JsonCliErrorCode = "declined" | "usage";

export const writeJsonCliEnvelope = (payload: {
  error: { code: JsonCliErrorCode; message: string };
  quote?: unknown;
}) => {
  writeJson(payload);
};

export const logInfo = (message: string) => {
  process.stderr.write(`${message}\n`);
};

export const logProgress = (message: string) => {
  process.stderr.write(`${message}\n`);
};

export const formatQuoteHuman = (quote: CustomerQuote): string => {
  const lines = [
    `Quote ID: ${quote.id}`,
    `Status: ${quote.status}`,
    `Price: ${formatCurrencyAud(quote.amount_cents)}`,
    `Contract hash: ${quote.contract_hash}`,
    `Expires: ${quote.expires_at}`,
    `Pricing model: ${quote.pricing_model_version}`,
    `Replayed: ${quote.replayed ? "yes" : "no"}`,
    "",
    "Repository:",
    `- URL: ${quote.repository_url}`,
    `- Base SHA: ${quote.repository_sha}`,
  ];

  if (isSnapshotQuote(quote)) {
    lines.push(
      `- Base branch: ${quote.repository.base_branch}`,
      `- Binding ID: ${quote.repository.binding_id}`,
      `- Snapshot ID: ${quote.repository.snapshot_id}`,
      `- Manifest hash: ${quote.repository.manifest_hash}`,
      `- Full name: ${quote.repository.full_name}`,
      `- GitHub repository ID: ${quote.repository.github_repository_id}`,
      "",
      "Pricing evidence:",
      `- Evidence hash: ${quote.pricing_evidence_hash}`,
      `- Confidence: ${quote.pricing.confidence}`,
      `- Range: ${formatCurrencyAud(quote.pricing.range.lowCents)} – ${formatCurrencyAud(quote.pricing.range.highCents)}`,
      `- Estimator decision: ${quote.pricing.estimatorDecision}`,
      `- Policy: ${quote.pricing.policyVersion}`,
      "",
      "Factors:",
      ...quote.pricing.factors.map((factor) => `- ${factor}`),
    );

    if (quote.pricing.executionConditions.length > 0) {
      lines.push("", "Execution conditions:");
      lines.push(
        ...quote.pricing.executionConditions.map(
          (condition) => `- ${condition}`,
        ),
      );
    }
  }

  lines.push(
    "",
    "Eligibility:",
    `- Code: ${quote.eligibility.code}`,
    `- Eligible: ${quote.eligibility.eligible ? "yes" : "no"}`,
  );

  if (quote.eligibility.reason) {
    lines.push(`- Reason: ${quote.eligibility.reason}`);
  }

  lines.push(
    "",
    "Task:",
    quote.task.description,
    "",
    "Acceptance criteria:",
    ...quote.task.acceptanceCriteria.map((item) => `- ${item}`),
    "",
    "Prohibited changes:",
    ...quote.task.prohibitedChanges.map((item) => `- ${item}`),
    "",
    "Terms:",
    quote.terms,
  );

  return lines.join("\n");
};

export const formatTaskOutcomeHuman = (task: CustomerTask) => {
  const lines = [`Task status: ${task.status}`];

  if (task.execution) {
    lines.push(
      `Execution: ${task.execution.state}`,
      `Claims: ${task.execution.claim_count}`,
      `Retry failures: ${task.execution.failure_count}`,
    );

    if (task.execution.next_attempt_at) {
      lines.push(`Next attempt: ${task.execution.next_attempt_at}`);
    }

    if (task.execution.customer_error_message) {
      lines.push(
        `Execution reason: ${task.execution.customer_error_message}`,
      );
    }
  }

  if (task.failure?.reason) {
    lines.push(`Failure: ${task.failure.reason}`);
  }

  if (task.output.pr_url) {
    lines.push(`Pull request: ${task.output.pr_url}`);
  }

  if (task.verifier.status) {
    lines.push(
      `Verification: ${task.verifier.status}${task.verifier.conclusion ? ` (${task.verifier.conclusion})` : ""}`,
    );
  }

  if (task.payment?.status) {
    lines.push(`Payment: ${task.payment.status}`);
  }

  return lines.join("\n");
};
