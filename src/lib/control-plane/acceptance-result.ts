import { ControlPlaneError } from "./errors";

export type AcceptanceRpcResult = {
  status: string;
  task_id: string | null;
};

export const requireAcceptedTaskId = (
  result: AcceptanceRpcResult | undefined,
): string => {
  if (result?.status === "expired") {
    throw new ControlPlaneError({
      code: "quote_expired",
      message: "The quote has expired.",
      status: 409,
    });
  }

  if (!result?.task_id) {
    throw new ControlPlaneError({
      code: "database_error",
      message: "The accepted task could not be loaded.",
      status: 500,
    });
  }

  return result.task_id;
};
