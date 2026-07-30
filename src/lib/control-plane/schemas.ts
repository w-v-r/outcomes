import { z } from "zod";

import { taskContractSchema } from "@/lib/pricing/domain";
import { githubBranchSchema } from "@/lib/repositories/domain";
import { normalizeGitHubRepositoryUrl } from "@/lib/repositories/github";

export const bindingQuoteInputSchema = z
  .object({
    idempotency_key: z.string().trim().min(8).max(160),
    repository_binding_id: z.string().uuid(),
    task: taskContractSchema,
  })
  .strict();

export const bindingQuoteInputShape = bindingQuoteInputSchema.shape;

export const legacyQuoteInputSchema = z
  .object({
    idempotency_key: z.string().trim().min(8).max(160),
    repository_sha: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{40}$/iu),
    repository_url: z.string().trim().min(1).max(500),
    task: taskContractSchema,
  })
  .strict();

export const createQuoteInputSchema = z.union([
  bindingQuoteInputSchema,
  legacyQuoteInputSchema,
]);

export const repositoryCaptureRequestSchema = z
  .object({
    base_branch: githubBranchSchema,
    base_sha: z.string().trim().regex(/^[0-9a-f]{40}$/u),
    repository_url: z
      .string()
      .trim()
      .url()
      .max(300)
      .refine(
        (value) => normalizeGitHubRepositoryUrl(value) === value,
        "A canonical GitHub repository URL is required.",
      ),
    stored_installation_id: z.string().uuid(),
  })
  .strict();

export const linearSourceInputSchema = z
  .object({
    content_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    issue_id: z.string().trim().min(1).max(160),
    issue_url: z.string().trim().url().max(500),
    project_id: z.string().trim().min(1).max(160),
    provider: z.literal("linear"),
    team_id: z.string().trim().min(1).max(160),
    workspace_id: z.string().trim().min(1).max(160),
  })
  .strict();

export const createAssessmentInputSchema = z
  .object({
    idempotency_key: z.string().trim().min(8).max(160),
    repository_binding_id: z.string().uuid(),
    source: linearSourceInputSchema.optional(),
    task: taskContractSchema,
  })
  .strict();

export const acceptQuoteInputSchema = z
  .object({
    contract_hash: z.string().trim().regex(/^[0-9a-f]{64}$/iu),
    idempotency_key: z.string().trim().min(8).max(160),
  })
  .strict();

export type CreateQuoteInput = z.infer<typeof createQuoteInputSchema>;
export type BindingQuoteInput = z.infer<typeof bindingQuoteInputSchema>;
export type LegacyQuoteInput = z.infer<typeof legacyQuoteInputSchema>;
export type CreateAssessmentInput = z.infer<
  typeof createAssessmentInputSchema
>;
export type RepositoryCaptureRequest = z.infer<
  typeof repositoryCaptureRequestSchema
>;
export type AcceptQuoteInput = z.infer<typeof acceptQuoteInputSchema>;
