import {
  ApiAuthenticationError,
  authenticateRequest,
} from "@/lib/api-keys/service";
import { toErrorResponse } from "@/lib/control-plane/errors";
import { createQuote } from "@/lib/control-plane/quotes";
import { createQuoteInputSchema } from "@/lib/control-plane/schemas";

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

    const parsedInput = createQuoteInputSchema.safeParse(body);

    if (!parsedInput.success) {
      return Response.json(
        {
          error: {
            code: "invalid_request",
            details: parsedInput.error.flatten(),
            message: "The quote request is invalid.",
          },
        },
        { status: 400 },
      );
    }

    const quote = await createQuote(principal, parsedInput.data);
    const status = quote.replayed
      ? 200
      : quote.status === "rejected"
        ? 422
        : 201;

    return Response.json({ quote }, { status });
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
