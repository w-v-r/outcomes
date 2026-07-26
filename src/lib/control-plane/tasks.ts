import "server-only";

import { type CustomerPrincipal } from "@/lib/api-keys/service";
import {
  chargeVerifiedTask,
  type ChargeVerifiedTaskResult,
} from "@/lib/billing/charge-verified-task";
import { createAdminClient } from "@/lib/supabase/admin";
import { GitHubActionsVerifierAdapter } from "@/lib/verifiers/github/adapter";
import { type VerifierAdapter } from "@/lib/verifiers/types";
import { CursorCloudWorkerAdapter } from "@/lib/workers/cursor/adapter";
import { type WorkerAdapter } from "@/lib/workers/types";

import { ControlPlaneError } from "./errors";
import { appendTaskEvent } from "./events";

type TaskRow = {
  actual_cost_usd_micros: number | null;
  agent_id: string | null;
  completed_at: string | null;
  created_at: string;
  failed_at: string | null;
  failure_reason: string | null;
  id: string;
  idempotency_key: string;
  output_ref: string | null;
  quote_id: string;
  repository_sha: string;
  repository_url: string;
  result_branch: string | null;
  result_pr_url: string | null;
  run_id: string | null;
  started_at: string | null;
  status: string;
  task_spec: {
    acceptanceCriteria: string[];
    description: string;
    prohibitedChanges: string[];
  };
  updated_at: string;
  usage: Record<string, unknown> | null;
  user_id: string;
  verified_at: string | null;
  verifier_conclusion: string | null;
  verifier_evidence: Record<string, unknown> | null;
  verifier_run_id: number | null;
  verifier_status: string | null;
  worker_completed_at: string | null;
  worker_model: string | null;
  worker_result: Record<string, unknown> | null;
};

type TaskDependencies = {
  chargeTask?: (
    taskId: string,
  ) => Promise<ChargeVerifiedTaskResult>;
  verifier?: VerifierAdapter;
  worker?: WorkerAdapter;
};

const TASK_SELECT =
  "id, user_id, quote_id, status, repository_url, repository_sha, task_spec, idempotency_key, agent_id, run_id, worker_model, result_branch, result_pr_url, output_ref, usage, actual_cost_usd_micros, worker_result, verifier_run_id, verifier_status, verifier_conclusion, verifier_evidence, started_at, worker_completed_at, verified_at, completed_at, failed_at, failure_reason, created_at, updated_at";

const requireAdminClient = () => {
  const supabase = createAdminClient();

  if (!supabase) {
    throw new ControlPlaneError({
      code: "service_unavailable",
      message: "The control plane is not configured.",
      status: 503,
    });
  }

  return supabase;
};

const loadOwnedTask = async (
  userId: string,
  taskId: string,
): Promise<TaskRow> => {
  const { data, error } = await requireAdminClient()
    .from("tasks")
    .select(TASK_SELECT)
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    throw new ControlPlaneError({
      code: "task_not_found",
      message: "The task was not found.",
      status: 404,
    });
  }

  return data as TaskRow;
};

const recordTerminalFailure = async ({
  eventType,
  reason,
  status,
  task,
}: {
  eventType: string;
  reason: string;
  status: "cancelled" | "verification_failed" | "worker_failed";
  task: TaskRow;
}) => {
  const supabase = requireAdminClient();
  const failedAt = new Date().toISOString();

  await supabase
    .from("tasks")
    .update({
      failed_at: failedAt,
      failure_reason: reason,
      status,
    })
    .eq("id", task.id)
    .eq("user_id", task.user_id);
  await appendTaskEvent({
    data: { reason },
    eventType,
    taskId: task.id,
    userId: task.user_id,
  });
};

const recoverStaleStartup = async (
  task: TaskRow,
  worker: WorkerAdapter,
) => {
  if (
    task.status !== "starting" ||
    task.agent_id ||
    task.run_id ||
    !task.started_at ||
    Date.now() - new Date(task.started_at).getTime() < 120_000
  ) {
    return task;
  }

  const supabase = requireAdminClient();
  const startedWorker = await worker.startTask({
    idempotencyKey: `outcomes-run:${task.idempotency_key}`,
    repositorySha: task.repository_sha,
    repositoryUrl: task.repository_url,
    task: task.task_spec,
    taskId: task.id,
  });
  const { error } = await supabase
    .from("tasks")
    .update({
      agent_id: startedWorker.agentId,
      run_id: startedWorker.runId,
      status: "executing",
      worker_model: startedWorker.modelId,
    })
    .eq("id", task.id)
    .eq("user_id", task.user_id)
    .eq("status", "starting")
    .is("agent_id", null);

  if (error) {
    throw new ControlPlaneError({
      code: "database_error",
      message: "The recovered Cursor run could not be persisted.",
      status: 500,
    });
  }

  await appendTaskEvent({
    data: {
      agent_id: startedWorker.agentId,
      run_id: startedWorker.runId,
    },
    eventType: "worker.start_recovered",
    taskId: task.id,
    userId: task.user_id,
  });

  return loadOwnedTask(task.user_id, task.id);
};

const reconcileWorker = async (
  task: TaskRow,
  worker: WorkerAdapter,
) => {
  if (task.status !== "executing" || !task.agent_id || !task.run_id) {
    return task;
  }

  const result = await worker.refreshTask({
    agentId: task.agent_id,
    runId: task.run_id,
  });

  if (result.status === "running") {
    return task;
  }

  if (result.status !== "finished") {
    await recordTerminalFailure({
      eventType:
        result.status === "cancelled"
          ? "worker.cancelled"
          : "worker.failed",
      reason:
        result.error ??
        `Cursor worker ended with status ${result.status}.`,
      status:
        result.status === "cancelled" ? "cancelled" : "worker_failed",
      task,
    });

    return loadOwnedTask(task.user_id, task.id);
  }

  if (!result.branch) {
    await recordTerminalFailure({
      eventType: "worker.failed",
      reason: "Cursor completed without a result branch to verify.",
      status: "worker_failed",
      task,
    });

    return loadOwnedTask(task.user_id, task.id);
  }

  const completedAt = new Date().toISOString();
  const { error } = await requireAdminClient()
    .from("tasks")
    .update({
      actual_cost_usd_micros:
        result.actualCostUsd === undefined
          ? null
          : Math.round(result.actualCostUsd * 1_000_000),
      output_ref: result.prUrl ?? result.branch,
      result_branch: result.branch,
      result_pr_url: result.prUrl ?? null,
      status: "worker_succeeded",
      usage: result.usage ?? null,
      worker_completed_at: completedAt,
      worker_result: result.output
        ? { summary: result.output.slice(0, 4_000) }
        : {},
    })
    .eq("id", task.id)
    .eq("user_id", task.user_id)
    .eq("status", "executing");

  if (error) {
    throw new ControlPlaneError({
      code: "database_error",
      message: "The completed Cursor run could not be persisted.",
      status: 500,
    });
  }

  await appendTaskEvent({
    data: {
      branch: result.branch,
      pr_url: result.prUrl ?? null,
    },
    eventType: "worker.completed",
    taskId: task.id,
    userId: task.user_id,
  });

  return loadOwnedTask(task.user_id, task.id);
};

const startVerifier = async (
  task: TaskRow,
  verifier: VerifierAdapter,
) => {
  if (task.status !== "worker_succeeded" || !task.result_branch) {
    return task;
  }

  const supabase = requireAdminClient();
  const { data: claimedTask } = await supabase
    .from("tasks")
    .update({
      verifier_status: "dispatching",
      verifying_at: new Date().toISOString(),
      status: "verifying",
    })
    .eq("id", task.id)
    .eq("user_id", task.user_id)
    .eq("status", "worker_succeeded")
    .is("verifier_run_id", null)
    .select("id")
    .maybeSingle();

  if (!claimedTask) {
    return loadOwnedTask(task.user_id, task.id);
  }

  try {
    const startedVerification = await verifier.startVerification({
      baselineSha: task.repository_sha,
      resultRef: task.result_branch,
      taskId: task.id,
    });

    await supabase
      .from("tasks")
      .update({
        verifier_evidence: { url: startedVerification.url },
        verifier_run_id: startedVerification.runId,
        verifier_status: "queued",
      })
      .eq("id", task.id)
      .eq("user_id", task.user_id)
      .eq("status", "verifying");
    await appendTaskEvent({
      data: {
        run_id: startedVerification.runId,
        url: startedVerification.url,
      },
      eventType: "verifier.started",
      taskId: task.id,
      userId: task.user_id,
    });
  } catch {
    await supabase
      .from("tasks")
      .update({
        status: "worker_succeeded",
        verifier_status: null,
        verifying_at: null,
      })
      .eq("id", task.id)
      .eq("user_id", task.user_id)
      .eq("status", "verifying")
      .is("verifier_run_id", null);

    throw new ControlPlaneError({
      code: "verifier_dispatch_failed",
      message: "Trusted verification could not be started.",
      status: 502,
    });
  }

  return loadOwnedTask(task.user_id, task.id);
};

const reconcileVerifier = async (
  task: TaskRow,
  verifier: VerifierAdapter,
) => {
  if (task.status !== "verifying" || !task.verifier_run_id) {
    return task;
  }

  const result = await verifier.refreshVerification(
    task.verifier_run_id,
  );
  const supabase = requireAdminClient();

  if (result.status !== "completed") {
    await supabase
      .from("tasks")
      .update({
        verifier_evidence: { url: result.url },
        verifier_status: result.status,
      })
      .eq("id", task.id)
      .eq("user_id", task.user_id);

    return loadOwnedTask(task.user_id, task.id);
  }

  if (result.conclusion !== "success") {
    await recordTerminalFailure({
      eventType: "verifier.failed",
      reason: `Trusted verifier concluded ${result.conclusion ?? "unknown"}.`,
      status: "verification_failed",
      task,
    });
    await supabase
      .from("tasks")
      .update({
        verifier_conclusion: result.conclusion,
        verifier_evidence: { url: result.url },
        verifier_status: "completed",
      })
      .eq("id", task.id)
      .eq("user_id", task.user_id);

    return loadOwnedTask(task.user_id, task.id);
  }

  const verifiedAt = new Date().toISOString();

  await supabase
    .from("tasks")
    .update({
      status: "verified",
      verified_at: verifiedAt,
      verifier_conclusion: result.conclusion,
      verifier_evidence: { url: result.url },
      verifier_status: "completed",
    })
    .eq("id", task.id)
    .eq("user_id", task.user_id)
    .eq("status", "verifying");
  await appendTaskEvent({
    data: {
      conclusion: result.conclusion,
      run_id: task.verifier_run_id,
      url: result.url,
    },
    eventType: "verifier.passed",
    taskId: task.id,
    userId: task.user_id,
  });

  return loadOwnedTask(task.user_id, task.id);
};

const chargeTaskIfVerified = async (
  task: TaskRow,
  chargeTask: (
    taskId: string,
  ) => Promise<ChargeVerifiedTaskResult>,
) => {
  if (!["verified", "charging"].includes(task.status)) {
    return task;
  }

  const payment = await chargeTask(task.id);

  await appendTaskEvent({
    data: {
      payment_id: payment.paymentId,
      payment_status: payment.paymentStatus,
      replayed: payment.replayed,
    },
    eventType:
      payment.paymentStatus === "failed" ||
      payment.paymentStatus === "unknown"
        ? "payment.failed"
        : "payment.submitted",
    taskId: task.id,
    userId: task.user_id,
  });

  return loadOwnedTask(task.user_id, task.id);
};

const projectTask = async (task: TaskRow) => {
  const supabase = requireAdminClient();
  const [{ data: events }, { data: payment }] = await Promise.all([
    supabase
      .from("task_events")
      .select("id, event_type, event_data, created_at")
      .eq("task_id", task.id)
      .eq("user_id", task.user_id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("payments")
      .select("provider_payment_id, status, amount_cents, currency")
      .eq("task_id", task.id)
      .eq("user_id", task.user_id)
      .maybeSingle(),
  ]);

  return {
    agent_id: task.agent_id,
    completed_at: task.completed_at,
    created_at: task.created_at,
    failure:
      task.failure_reason || task.failed_at
        ? {
            at: task.failed_at,
            reason: task.failure_reason,
          }
        : null,
    id: task.id,
    output: {
      branch: task.result_branch,
      pr_url: task.result_pr_url,
      ref: task.output_ref,
    },
    payment: payment ?? null,
    quote_id: task.quote_id,
    repository_sha: task.repository_sha,
    repository_url: task.repository_url,
    run_id: task.run_id,
    started_at: task.started_at,
    status: task.status,
    task: task.task_spec,
    timeline: events ?? [],
    updated_at: task.updated_at,
    usage: task.usage,
    verified_at: task.verified_at,
    verifier: {
      conclusion: task.verifier_conclusion,
      evidence: task.verifier_evidence,
      run_id: task.verifier_run_id,
      status: task.verifier_status,
    },
    worker_model: task.worker_model,
  };
};

export const getTaskStatus = async (
  principal: CustomerPrincipal,
  taskId: string,
  dependencies: TaskDependencies = {},
) => {
  const worker =
    dependencies.worker ?? new CursorCloudWorkerAdapter();
  const verifier =
    dependencies.verifier ?? new GitHubActionsVerifierAdapter();
  const chargeTask = dependencies.chargeTask ?? chargeVerifiedTask;

  let task = await loadOwnedTask(principal.userId, taskId);
  task = await recoverStaleStartup(task, worker);
  task = await reconcileWorker(task, worker);
  task = await startVerifier(task, verifier);
  task = await reconcileVerifier(task, verifier);
  task = await chargeTaskIfVerified(task, chargeTask);

  return projectTask(task);
};
