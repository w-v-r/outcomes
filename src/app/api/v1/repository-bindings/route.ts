import {
  ApiAuthenticationError,
  authenticateRequest,
} from "@/lib/api-keys/service";
import { toErrorResponse } from "@/lib/control-plane/errors";
import { repositoryCaptureRequestSchema } from "@/lib/control-plane/schemas";
import { captureRepositoryBinding } from "@/lib/repositories/application";

export const maxDuration = 300;
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

    const parsedInput = repositoryCaptureRequestSchema.safeParse(body);

    if (!parsedInput.success) {
      return Response.json(
        {
          error: {
            code: "invalid_request",
            details: parsedInput.error.flatten(),
            message: "The repository preflight request is invalid.",
          },
        },
        { status: 400 },
      );
    }

    const result = await captureRepositoryBinding(
      principal,
      parsedInput.data,
    );

    return Response.json(result, { status: 201 });
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
