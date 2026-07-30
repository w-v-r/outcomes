import { z } from "zod";

export const customerPricingEvidenceSchema = z
  .object({
    caveat: z.literal(
      "Planning estimate from a deterministic, uncalibrated policy; not a delivery guarantee.",
    ),
    confidence: z.enum(["low", "medium", "high"]),
    estimator: z
      .object({
        id: z.string().trim().min(1),
        version: z.string().trim().min(1),
      })
      .strict(),
    estimatorDecision: z.enum([
      "accept",
      "accept_with_conditions",
      "decompose",
      "decline",
    ]),
    executionConditions: z.array(z.string().trim().min(1)),
    factors: z.array(z.string().trim().min(1)).min(1),
    policyVersion: z.string().trim().min(1),
    range: z
      .object({
        currency: z.literal("AUD"),
        highCents: z.number().int().nonnegative(),
        lowCents: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .refine(
    ({ range }) => range.highCents >= range.lowCents,
    "The pricing range must be ordered.",
  );

export type CustomerPricingEvidence = z.infer<
  typeof customerPricingEvidenceSchema
>;
