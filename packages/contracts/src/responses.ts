import { z } from "zod";

import { customerPricingEvidenceSchema } from "./pricing-evidence.js";
import { taskContractSchema } from "./task-contract.js";
import { QUOTE_CUSTOMER_STATUSES } from "./errors.js";

const eligibilityDecisionSchema = z
  .object({
    code: z.string(),
    conditions: z.array(z.string()).optional(),
    eligible: z.boolean(),
    estimatorDecision: z
      .enum([
        "accept",
        "accept_with_conditions",
        "decompose",
        "decline",
      ])
      .optional(),
    normalizedRepositoryUrl: z.string().nullable().optional(),
    reason: z.string().optional(),
  })
  .passthrough();

export const installationGenerationSchema = z
  .object({
    account: z
      .object({
        login: z.string(),
        type: z.string(),
      })
      .strict(),
    created_at: z.string(),
    installation_generation_id: z.string().uuid(),
    repository_selection: z.enum(["all", "selected"]),
    status: z.enum(["active", "suspended"]),
  })
  .strict();

export const listInstallationsResponseSchema = z
  .object({
    installations: z.array(installationGenerationSchema),
  })
  .strict();

export const repositoryCaptureResponseSchema = z
  .object({
    binding: z
      .object({
        base_branch: z.string(),
        base_sha: z.string(),
        id: z.string().uuid(),
        manifest_hash: z.string(),
        repository: z
          .object({
            full_name: z.string(),
            github_repository_id: z.number(),
            url: z.string().url(),
            visibility: z.enum(["public", "private", "internal"]),
          })
          .strict(),
        snapshot_id: z.string().uuid(),
      })
      .strict(),
  })
  .strict();

const repositoryIdentitySchema = z
  .object({
    base_branch: z.string(),
    base_sha: z.string(),
    binding_id: z.string().uuid(),
    full_name: z.string(),
    manifest_hash: z.string(),
    snapshot_id: z.string().uuid(),
    url: z.string().url(),
  })
  .strict();

export const customerAssessmentSchema = z
  .object({
    accepted: z.literal(false),
    confidence: z.enum(["low", "medium", "high"]),
    created_at: z.string(),
    decision: z.enum([
      "accept",
      "accept_with_conditions",
      "decompose",
      "decline",
    ]),
    evidence_hash: z.string(),
    execution_eligibility: eligibilityDecisionSchema,
    id: z.string().uuid(),
    pricing: customerPricingEvidenceSchema,
    pricing_evidence_hash: z.string(),
    replayed: z.boolean(),
    repository: repositoryIdentitySchema.extend({
      github_repository_id: z.number().optional(),
    }),
    source: z
      .object({
        content_sha256: z.string(),
        issue_id: z.string(),
        issue_url: z.string().url(),
        project_id: z.string(),
        provider: z.literal("linear"),
        team_id: z.string(),
        workspace_id: z.string(),
      })
      .strict()
      .nullable(),
    task: taskContractSchema,
  })
  .passthrough();

export const createAssessmentResponseSchema = z
  .object({
    assessment: customerAssessmentSchema,
  })
  .strict();

const quoteBaseSchema = z.object({
  amount_cents: z.number().int(),
  contract_hash: z.string(),
  currency: z.literal("AUD"),
  eligibility: eligibilityDecisionSchema,
  expires_at: z.string(),
  id: z.string().uuid(),
  pricing_model_version: z.string(),
  replayed: z.boolean(),
  repository_sha: z.string(),
  repository_url: z.string(),
  status: z.enum(QUOTE_CUSTOMER_STATUSES),
  task: taskContractSchema,
  task_id: z.string().uuid().nullable(),
  terms: z.string(),
});

export const customerLegacyQuoteSchema = quoteBaseSchema.strict();

export const customerSnapshotQuoteSchema = quoteBaseSchema
  .extend({
    pricing: customerPricingEvidenceSchema,
    pricing_evidence_hash: z.string(),
    repository: repositoryIdentitySchema.extend({
      github_repository_id: z.number(),
    }),
  })
  .strict();

export const customerQuoteSchema = z.union([
  customerSnapshotQuoteSchema,
  customerLegacyQuoteSchema,
]);

export const createQuoteResponseSchema = z
  .object({
    quote: customerQuoteSchema,
  })
  .strict();

export const isSnapshotQuote = (
  quote: z.infer<typeof customerQuoteSchema>,
): quote is z.infer<typeof customerSnapshotQuoteSchema> =>
  "pricing" in quote && quote.pricing !== undefined;

export const acceptQuoteResponseSchema = z
  .object({
    task: z
      .object({
        agent_id: z.string().nullable(),
        replayed: z.boolean(),
        run_id: z.string().nullable(),
        status: z.string(),
        task_id: z.string().uuid(),
      })
      .strict(),
  })
  .strict();

export const customerTaskExecutionSchema = z
  .object({
    claim_count: z.number().int().positive(),
    completed_at: z.string().nullable(),
    customer_error_code: z.string().nullable(),
    customer_error_message: z.string().nullable(),
    failure_count: z.number().int().nonnegative(),
    id: z.string().uuid(),
    next_attempt_at: z.string().nullable(),
    started_at: z.string().nullable(),
    state: z.enum([
      "claimed",
      "publishing",
      "retry_wait",
      "succeeded",
      "failed",
    ]),
  })
  .strict();

export const customerTaskSchema = z
  .object({
    agent_id: z.string().nullable(),
    completed_at: z.string().nullable(),
    created_at: z.string(),
    execution: customerTaskExecutionSchema.nullable(),
    failure: z
      .object({
        at: z.string().nullable(),
        reason: z.string().nullable(),
      })
      .nullable(),
    id: z.string().uuid(),
    output: z
      .object({
        branch: z.string().nullable(),
        pr_url: z.string().nullable(),
        ref: z.string().nullable(),
      })
      .strict(),
    payment: z
      .object({
        amount_cents: z.number().nullable().optional(),
        currency: z.string().nullable().optional(),
        provider_payment_id: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable(),
    quote_id: z.string().uuid(),
    repository_sha: z.string(),
    repository_url: z.string(),
    run_id: z.string().nullable(),
    started_at: z.string().nullable(),
    status: z.string(),
    task: taskContractSchema,
    timeline: z.array(z.unknown()),
    updated_at: z.string(),
    usage: z.record(z.unknown()).nullable(),
    verified_at: z.string().nullable(),
    verifier: z
      .object({
        conclusion: z.string().nullable(),
        evidence: z.unknown().nullable(),
        run_id: z.number().nullable(),
        status: z.string().nullable(),
      })
      .strict(),
    worker_model: z.string().nullable(),
  })
  .passthrough();

export const getTaskResponseSchema = z
  .object({
    task: customerTaskSchema,
  })
  .strict();

export type CustomerQuote = z.infer<typeof customerQuoteSchema>;
export type CustomerTask = z.infer<typeof customerTaskSchema>;
export type InstallationGeneration = z.infer<
  typeof installationGenerationSchema
>;
