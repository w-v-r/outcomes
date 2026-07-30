import {
  ApiAuthenticationError,
  authenticateRequest,
} from "@/lib/api-keys/service";
import { assessTask } from "@/lib/control-plane/assessments";
import { toErrorResponse } from "@/lib/control-plane/errors";
import { createAssessmentInputSchema } from "@/lib/control-plane/schemas";

export const runtime = "nodejs";

export const POST = async (request: Request) => {
  try {
    const principal = await authenticateRequest(request);
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return Response.json(
        {
          error: {
            code: "invalid_json",
            message: "Provide a valid JSON request body.",
          },
        },
        { status: 400 },
      );
    }

    const parsedInput = createAssessmentInputSchema.safeParse(body);

    if (!parsedInput.success) {
      return Response.json(
        {
          error: {
            code: "invalid_request",
            details: parsedInput.error.flatten(),
            message: "The assessment request is invalid.",
          },
        },
        { status: 400 },
      );
    }

    const assessment = await assessTask(principal, parsedInput.data);

    return Response.json(
      { assessment },
      { status: assessment.replayed ? 200 : 201 },
    );
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
