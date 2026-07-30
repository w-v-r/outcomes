import { readFileSync } from "node:fs";

import {
  taskContractSchema,
  type TaskContract,
} from "@outcomes/contracts";

export type ParsedTaskInput = TaskContract;

export type TaskInputOptions = {
  acceptance?: string[];
  contractFile?: string;
  prohibited?: string[];
  task?: string;
};

export const parseTaskInput = (
  options: TaskInputOptions,
): ParsedTaskInput => {
  if (options.contractFile) {
    const raw = readFileSync(options.contractFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return taskContractSchema.parse(parsed);
  }

  if (!options.task) {
    throw new Error(
      "Provide --task, --task-file, or a JSON contract file path.",
    );
  }

  const acceptanceCriteria = options.acceptance ?? [];

  if (acceptanceCriteria.length < 1) {
    throw new Error(
      "Provide at least one --acceptance flag or use --task-file with a JSON contract.",
    );
  }

  const prohibitedChanges = options.prohibited ?? [];

  if (prohibitedChanges.length < 1) {
    throw new Error(
      "Provide at least one --prohibited flag or use --task-file with a JSON contract.",
    );
  }

  return taskContractSchema.parse({
    acceptanceCriteria,
    description: options.task,
    prohibitedChanges,
  });
};
