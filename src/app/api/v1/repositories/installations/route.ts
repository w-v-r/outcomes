import {
  ApiAuthenticationError,
  authenticateRequest,
} from "@/lib/api-keys/service";
import { toErrorResponse } from "@/lib/control-plane/errors";
import { listRepositoryInstallations } from "@/lib/repositories/application";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
    const principal = await authenticateRequest(request);
    const installations = await listRepositoryInstallations(principal);

    return Response.json({ installations });
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
