import "server-only";

import { type CustomerPrincipal } from "@/lib/api-keys/service";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  requireAcceptedTaskId,
  type AcceptanceRpcResult,
} from "./acceptance-result";
import { ControlPlaneError } from "./errors";
import { type AcceptQuoteInput } from "./schemas";

type AcceptedTaskRow = {
  agent_id: string | null;
  id: string;
  run_id: string | null;
  status: string;
};

const TASK_SELECT = "id, status, agent_id, run_id";

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

  return {
    agent_id: task.agent_id,
    replayed: acceptanceResult?.created !== true,
    run_id: task.run_id,
    status: task.status,
    task_id: task.id,
  };
};
