import "server-only";

import { type TaskContract } from "./domain";

export type TaskSafetyDecision =
  | {
      code: "safe_for_assessment";
      safe: true;
    }
  | {
      code:
        | "contradictory_task"
        | "external_business_outcome"
        | "unsafe_task";
      reason: string;
      safe: false;
    };

const includesOpposingRequirements = (
  task: TaskContract,
  taskText: string,
): boolean => {
  const affirmativeTaskText = [
    task.description,
    ...task.acceptanceCriteria,
  ].join(" ");
  const requiresTestChanges =
    /\b(add|change|edit|modify|rewrite|remove)\b.{0,35}\btests?\b/iu.test(
      affirmativeTaskText,
    );
  const forbidsTestChanges =
    /\b(do not|don't|must not|without)\b.{0,35}\b(change|edit|modify|touch|rewrite|remove)\b.{0,20}\btests?\b/iu.test(
      taskText,
    );
  const returnsZero =
    /\b(return|returns?)\b.{0,30}\b(zero|0)\b/iu.test(taskText);
  const throwsError =
    /\bthrow(s|ing)?\b.{0,30}\b(error|exception)\b/iu.test(taskText);

  return (
    (requiresTestChanges && forbidsTestChanges) ||
    (returnsZero && throwsError)
  );
};

export const assessTaskSafety = (
  task: TaskContract,
): TaskSafetyDecision => {
  const taskText = [
    task.description,
    ...task.acceptanceCriteria,
    ...task.prohibitedChanges,
  ].join(" ");

  if (includesOpposingRequirements(task, taskText)) {
    return {
      code: "contradictory_task",
      reason: "The task contains mutually contradictory requirements.",
      safe: false,
    };
  }

  if (
    /\b(guarantee|guaranteed|promise|ensure)\b.{0,80}\b(revenue|profit|sales|conversion|market share|customer growth)\b/iu.test(
      taskText,
    ) ||
    /\b(revenue|profit|sales|conversion|market share|customer growth)\b.{0,80}\b(guarantee|guaranteed|promise|ensure)\b/iu.test(
      taskText,
    )
  ) {
    return {
      code: "external_business_outcome",
      reason:
        "External business outcomes cannot be verified from a repository change.",
      safe: false,
    };
  }

  if (
    /\b(exfiltrate|steal|harvest)\b.{0,50}\b(secret|credential|token|password|key)s?\b/iu.test(
      taskText,
    ) ||
    /\b(disable|bypass|remove)\b.{0,40}\b(authentication|authorization|security controls?|audit logging)\b/iu.test(
      taskText,
    )
  ) {
    return {
      code: "unsafe_task",
      reason: "The requested work would weaken security or expose secrets.",
      safe: false,
    };
  }

  return {
    code: "safe_for_assessment",
    safe: true,
  };
};
