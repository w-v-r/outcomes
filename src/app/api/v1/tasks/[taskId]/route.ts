import {
  ApiAuthenticationError,
  authenticateRequest,
} from "@/lib/api-keys/service";
import { toErrorResponse } from "@/lib/control-plane/errors";
import { getTaskStatus } from "@/lib/control-plane/tasks";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const GET = async (
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) => {
  try {
    const principal = await authenticateRequest(request);
    const { taskId } = await context.params;

    if (!UUID_PATTERN.test(taskId)) {
      return Response.json(
        {
          error: {
            code: "invalid_task_id",
            message: "The task ID is invalid.",
          },
        },
        { status: 400 },
      );
    }

    const task = await getTaskStatus(principal, taskId);
    return Response.json({ task });
  } catch (error) {
    if (error instanceof ApiAuthenticationError) {
      return Response.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        {
          headers: {
            "WWW-Authenticate": 'Bearer realm="Outcomes API"',
          },
          status: error.status,
        },
      );
    }

    return toErrorResponse(error);
  }
};
