import { z } from "zod";

import { taskContractSchema } from "@/lib/pricing/domain";

export const createQuoteInputSchema = z
  .object({
    idempotency_key: z.string().trim().min(8).max(160),
    repository_sha: z.string().trim().regex(/^[0-9a-f]{40}$/iu),
    repository_url: z.string().trim().min(1).max(500),
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
export type AcceptQuoteInput = z.infer<typeof acceptQuoteInputSchema>;
