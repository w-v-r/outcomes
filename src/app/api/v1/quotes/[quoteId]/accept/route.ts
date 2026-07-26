import {
  ApiAuthenticationError,
  authenticateRequest,
} from "@/lib/api-keys/service";
import { acceptQuoteAndStart } from "@/lib/control-plane/acceptance";
import { toErrorResponse } from "@/lib/control-plane/errors";
import { acceptQuoteInputSchema } from "@/lib/control-plane/schemas";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const POST = async (
  request: Request,
  context: { params: Promise<{ quoteId: string }> },
) => {
  try {
    const principal = await authenticateRequest(request);
    const { quoteId } = await context.params;

    if (!UUID_PATTERN.test(quoteId)) {
      return Response.json(
        {
          error: {
            code: "invalid_quote_id",
            message: "The quote ID is invalid.",
          },
        },
        { status: 400 },
      );
    }

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

    const parsedInput = acceptQuoteInputSchema.safeParse(body);

    if (!parsedInput.success) {
      return Response.json(
        {
          error: {
            code: "invalid_request",
            details: parsedInput.error.flatten(),
            message: "The quote acceptance request is invalid.",
          },
        },
        { status: 400 },
      );
    }

    const task = await acceptQuoteAndStart(
      principal,
      quoteId,
      parsedInput.data,
    );

    return Response.json({ task }, { status: 202 });
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
