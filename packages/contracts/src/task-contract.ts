import { z } from "zod";

export const taskContractSchema = z
  .object({
    acceptanceCriteria: z
      .array(z.string().trim().min(1).max(500))
      .min(1)
      .max(8),
    description: z.string().trim().min(1).max(1_500),
    prohibitedChanges: z
      .array(z.string().trim().min(1).max(500))
      .min(1)
      .max(8),
  })
  .strict();

export type TaskContract = z.infer<typeof taskContractSchema>;
