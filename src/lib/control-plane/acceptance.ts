import "server-only";

import { type CustomerPrincipal } from "@/lib/api-keys/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { CursorCloudWorkerAdapter } from "@/lib/workers/cursor/adapter";
import { type WorkerAdapter } from "@/lib/workers/types";

import {
  requireAcceptedTaskId,
  type AcceptanceRpcResult,
} from "./acceptance-result";
import { ControlPlaneError } from "./errors";
import { appendTaskEvent } from "./events";
import { type AcceptQuoteInput } from "./schemas";

type AcceptedTaskRow = {
  agent_id: string | null;
  id: string;
  idempotency_key: string;
  repository_sha: string;
  repository_url: string;
  run_id: string | null;
  status: string;
  task_spec: {
    acceptanceCriteria: string[];
    description: string;
    prohibitedChanges: string[];
  };
};

const TASK_SELECT =
  "id, status, idempotency_key, repository_url, repository_sha, task_spec, agent_id, run_id";

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

export const acceptQuoteAndStart = async (
  principal: CustomerPrincipal,
  quoteId: string,
  input: AcceptQuoteInput,
  worker: WorkerAdapter = new CursorCloudWorkerAdapter(),
) => {
  const supabase = requireAdminClient();
  const { data: billingAccount, error: billingError } = await supabase
    .from("billing_accounts")
    .select("id")
    .eq("user_id", principal.userId)
    .eq("status", "ready")
    .maybeSingle();

  if (billingError || !billingAccount) {
    throw new ControlPlaneError({
      code: "billing_not_ready",
      message: "Complete sandbox billing setup before starting work.",
      status: 409,
    });
  }

  const { data: acceptanceRows, error: acceptanceError } =
    await supabase.rpc("accept_quote_and_create_task", {
      p_contract_hash: input.contract_hash,
      p_idempotency_key: input.idempotency_key,
      p_quote_id: quoteId,
      p_user_id: principal.userId,
    });

  if (acceptanceError) {
    const message = acceptanceError.message.toLowerCase();
    const isNotFound = message.includes("not found");
    const isConflict =
      message.includes("different terms") ||
      message.includes("not pending") ||
      message.includes("expired") ||
      message.includes("does not match") ||
      message.includes("not eligible");

    throw new ControlPlaneError({
      code: isNotFound ? "quote_not_found" : "quote_not_acceptable",
      message: isNotFound
        ? "The quote was not found."
        : "The quote cannot be accepted with these terms.",
      status: isNotFound ? 404 : isConflict ? 409 : 500,
    });
  }

  const acceptanceResult = (
    acceptanceRows as AcceptanceRpcResult[] | null
  )?.[0];
  const acceptedTaskId = requireAcceptedTaskId(acceptanceResult);

  const { data: taskData, error: taskError } = await supabase
    .from("tasks")
    .select(TASK_SELECT)
    .eq("id", acceptedTaskId)
    .eq("user_id", principal.userId)
    .single();

  if (taskError || !taskData) {
    throw new ControlPlaneError({
      code: "database_error",
      message: "The accepted task could not be loaded.",
      status: 500,
    });
  }

  const task = taskData as AcceptedTaskRow;

  if (task.agent_id && task.run_id) {
    return {
      agent_id: task.agent_id,
      replayed: true,
      run_id: task.run_id,
      status: task.status,
      task_id: task.id,
    };
  }

  const { data: claimedTask } = await supabase
    .from("tasks")
    .update({
      started_at: new Date().toISOString(),
      status: "starting",
    })
    .eq("id", task.id)
    .eq("user_id", principal.userId)
    .eq("status", "approved")
    .is("agent_id", null)
    .select("id")
    .maybeSingle();

  if (!claimedTask) {
    return {
      agent_id: task.agent_id,
      replayed: true,
      run_id: task.run_id,
      status: task.status,
      task_id: task.id,
    };
  }

  await appendTaskEvent({
    eventType: "worker.starting",
    taskId: task.id,
    userId: principal.userId,
  });

  try {
    const startedWorker = await worker.startTask({
      idempotencyKey: `outcomes-run:${task.idempotency_key}`,
      repositorySha: task.repository_sha,
      repositoryUrl: task.repository_url,
      task: task.task_spec,
      taskId: task.id,
    });
    const { error: persistError } = await supabase
      .from("tasks")
      .update({
        agent_id: startedWorker.agentId,
        run_id: startedWorker.runId,
        status: "executing",
        worker_model: startedWorker.modelId,
        worker_provider: worker.provider,
        worker_runtime: worker.runtime,
      })
      .eq("id", task.id)
      .eq("user_id", principal.userId)
      .eq("status", "starting");

    if (persistError) {
      throw new Error("The Cursor run identifiers could not be persisted.", {
        cause: persistError,
      });
    }

    await appendTaskEvent({
      data: {
        agent_id: startedWorker.agentId,
        run_id: startedWorker.runId,
      },
      eventType: "worker.started",
      taskId: task.id,
      userId: principal.userId,
    });

    return {
      agent_id: startedWorker.agentId,
      replayed: false,
      run_id: startedWorker.runId,
      status: "executing",
      task_id: task.id,
    };
  } catch (error) {
    const failureReason =
      error instanceof Error ? error.message : "Cursor worker startup failed.";

    await supabase
      .from("tasks")
      .update({
        failed_at: new Date().toISOString(),
        failure_reason: failureReason,
        status: "worker_failed",
      })
      .eq("id", task.id)
      .eq("user_id", principal.userId);
    await appendTaskEvent({
      data: { reason: failureReason },
      eventType: "worker.start_failed",
      taskId: task.id,
      userId: principal.userId,
    }).catch(() => undefined);

    throw new ControlPlaneError({
      code: "worker_start_failed",
      message: "The Cursor worker could not be started.",
      status: 502,
    });
  }
};
