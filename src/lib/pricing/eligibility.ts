import "server-only";

import { type TaskContract } from "./domain";
import {
  FIXTURE_REPOSITORY,
  ZERO_DIVISION_TASK_CONTRACT,
  normalizeGitHubRepositoryUrl,
} from "./registry";
import { assessTaskSafety } from "./task-safety";

export type EligibilityDecision =
  | {
      code: "eligible";
      eligible: true;
      normalizedRepositoryUrl: string;
    }
  | {
      code:
        | "repository_not_allowed"
        | "repository_sha_not_allowed"
        | "task_not_allowed"
        | "contradictory_task"
        | "revenue_guarantee_not_allowed";
      eligible: false;
      normalizedRepositoryUrl: string | null;
      reason: string;
    };

export type SnapshotEligibilityDecision =
  | {
      code: "eligible";
      eligible: true;
      normalizedRepositoryUrl: string;
    }
  | {
      code:
        | "contradictory_task"
        | "external_business_outcome"
        | "repository_invalid"
        | "repository_sha_invalid"
        | "unsafe_task";
      eligible: false;
      normalizedRepositoryUrl: string | null;
      reason: string;
    };

const normalizeText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[.]+$/u, "")
    .replace(/\s+/gu, " ");

const normalizeList = (values: string[]) =>
  values.map(normalizeText).sort((left, right) => left.localeCompare(right));

const listsMatch = (left: string[], right: string[]) =>
  JSON.stringify(normalizeList(left)) ===
  JSON.stringify(normalizeList(right));

export const decideSnapshotTaskEligibility = ({
  repositorySha,
  repositoryUrl,
  task,
}: {
  repositorySha: string;
  repositoryUrl: string;
  task: TaskContract;
}): SnapshotEligibilityDecision => {
  const normalizedRepositoryUrl =
    normalizeGitHubRepositoryUrl(repositoryUrl);

  if (!normalizedRepositoryUrl) {
    return {
      code: "repository_invalid",
      eligible: false,
      normalizedRepositoryUrl: null,
      reason: "A canonical GitHub repository URL is required.",
    };
  }

  if (!/^[0-9a-f]{40}$/u.test(repositorySha)) {
    return {
      code: "repository_sha_invalid",
      eligible: false,
      normalizedRepositoryUrl,
      reason: "An immutable lowercase Git commit SHA is required.",
    };
  }

  const safety = assessTaskSafety(task);

  if (!safety.safe) {
    return {
      code: safety.code,
      eligible: false,
      normalizedRepositoryUrl,
      reason: safety.reason,
    };
  }

  return {
    code: "eligible",
    eligible: true,
    normalizedRepositoryUrl,
  };
};

export const decideTaskEligibility = ({
  repositorySha,
  repositoryUrl,
  task,
}: {
  repositorySha: string;
  repositoryUrl: string;
  task: TaskContract;
}): EligibilityDecision => {
  const normalizedRepositoryUrl =
    normalizeGitHubRepositoryUrl(repositoryUrl);

  if (
    normalizedRepositoryUrl?.toLowerCase() !==
    FIXTURE_REPOSITORY.url.toLowerCase()
  ) {
    return {
      code: "repository_not_allowed",
      eligible: false,
      normalizedRepositoryUrl,
      reason: "Only the pinned calculator fixture repository is supported.",
    };
  }

  if (
    repositorySha.toLowerCase() !==
    FIXTURE_REPOSITORY.baselineSha.toLowerCase()
  ) {
    return {
      code: "repository_sha_not_allowed",
      eligible: false,
      normalizedRepositoryUrl,
      reason: "The repository SHA does not match the trusted baseline.",
    };
  }

  const taskText = [
    task.description,
    ...task.acceptanceCriteria,
    ...task.prohibitedChanges,
  ].join(" ");

  if (
    /\b(revenue|profit|sales)\b.{0,60}\b(guarantee|guaranteed|promise)\b/iu.test(
      taskText,
    ) ||
    /\b(guarantee|guaranteed|promise)\b.{0,60}\b(revenue|profit|sales)\b/iu.test(
      taskText,
    )
  ) {
    return {
      code: "revenue_guarantee_not_allowed",
      eligible: false,
      normalizedRepositoryUrl,
      reason: "Revenue guarantees are outside the supported task contract.",
    };
  }

  const contradictoryZeroDivision =
    /\b(return|returns?)\b.{0,30}\b(zero|0)\b/iu.test(taskText) &&
    /\bthrow(s|ing)?\b.{0,30}\b(error|exception)\b/iu.test(taskText);

  if (contradictoryZeroDivision) {
    return {
      code: "contradictory_task",
      eligible: false,
      normalizedRepositoryUrl,
      reason:
        "The requested zero-division behavior is internally contradictory.",
    };
  }

  const contractMatches =
    normalizeText(task.description) ===
      normalizeText(ZERO_DIVISION_TASK_CONTRACT.description) &&
    listsMatch(
      task.acceptanceCriteria,
      ZERO_DIVISION_TASK_CONTRACT.acceptanceCriteria,
    ) &&
    listsMatch(
      task.prohibitedChanges,
      ZERO_DIVISION_TASK_CONTRACT.prohibitedChanges,
    );

  if (!contractMatches) {
    return {
      code: "task_not_allowed",
      eligible: false,
      normalizedRepositoryUrl,
      reason: "The task does not match an allowlisted bounded contract.",
    };
  }

  return {
    code: "eligible",
    eligible: true,
    normalizedRepositoryUrl,
  };
};
