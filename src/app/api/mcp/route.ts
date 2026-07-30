import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";

import {
  authenticateApiKey,
  type CustomerPrincipal,
} from "@/lib/api-keys/service";
import { acceptQuoteAndStart } from "@/lib/control-plane/acceptance";
import { ControlPlaneError } from "@/lib/control-plane/errors";
import { createQuote } from "@/lib/control-plane/quotes";
import {
  acceptQuoteInputSchema,
  bindingQuoteInputShape,
} from "@/lib/control-plane/schemas";
import { getTaskStatus } from "@/lib/control-plane/tasks";

export const runtime = "nodejs";
export const maxDuration = 60;

const getPrincipal = (extra: {
  authInfo?: { extra?: Record<string, unknown> };
}): CustomerPrincipal => {
  const apiKeyId = extra.authInfo?.extra?.apiKeyId;
  const userId = extra.authInfo?.extra?.userId;

  if (typeof apiKeyId !== "string" || typeof userId !== "string") {
    throw new ControlPlaneError({
      code: "invalid_api_key",
      message: "The authenticated customer principal is unavailable.",
      status: 401,
    });
  }

  return { apiKeyId, userId };
};

const toToolResult = (value: unknown, isError = false) => ({
  content: [
    {
      text: JSON.stringify(value, null, 2),
      type: "text" as const,
    },
  ],
  isError,
});

const toToolError = (error: unknown) => {
  if (error instanceof ControlPlaneError) {
    return toToolResult(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      true,
    );
  }

  return toToolResult(
    {
      error: {
        code: "internal_error",
        message: "The Outcomes request could not be completed.",
      },
    },
    true,
  );
};

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "quote_task",
      {
        description:
          "Create an immutable fixed-price quote for a coding outcome using a repository_binding_id returned by repository preflight. Repository identity and pricing are resolved by the Outcomes service; do not calculate pricing locally or supply commands to run at quote time. After calling, present the exact price and complete contract. Do not call accept_quote_and_start without explicit approval. Execution remains fail-closed to allowlisted repository and task contracts.",
        inputSchema: bindingQuoteInputShape,
        title: "Quote task",
      },
      async (input, extra) => {
        try {
          const quote = await createQuote(getPrincipal(extra), input);

          return toToolResult(
            { quote },
            quote.status === "rejected",
          );
        } catch (error) {
          return toToolError(error);
        }
      },
    );

    server.registerTool(
      "accept_quote_and_start",
      {
        description:
          "Accept an exact quote contract and asynchronously start its worker. Call only after presenting the quote's exact price and complete contract to the user and receiving explicit approval. Pass back the unchanged quote ID and contract hash.",
        inputSchema: {
          contract_hash:
            acceptQuoteInputSchema.shape.contract_hash,
          idempotency_key:
            acceptQuoteInputSchema.shape.idempotency_key,
          quote_id: z.string().uuid(),
        },
        title: "Accept quote and start",
      },
      async ({ quote_id, ...input }, extra) => {
        try {
          const task = await acceptQuoteAndStart(
            getPrincipal(extra),
            quote_id,
            input,
          );

          return toToolResult({ task });
        } catch (error) {
          return toToolError(error);
        }
      },
    );

    server.registerTool(
      "get_task_status",
      {
        description:
          "Reconcile and return worker, verifier, and payment status for a task. Poll until a terminal state, then report the resulting branch or pull request, verification result, and payment status. Surface worker or verification failures without claiming completion.",
        inputSchema: {
          task_id: z.string().uuid(),
        },
        title: "Get task status",
      },
      async ({ task_id }, extra) => {
        try {
          const task = await getTaskStatus(
            getPrincipal(extra),
            task_id,
          );

          return toToolResult({ task });
        } catch (error) {
          return toToolError(error);
        }
      },
    );
  },
  {
    serverInfo: {
      name: "outcomes",
      version: "1.0.0",
    },
  },
  {
    basePath: "/api",
    disableSse: true,
    maxDuration: 60,
    sessionIdGenerator: undefined,
  },
);

const authenticatedHandler = withMcpAuth(
  handler,
  async (_request, bearerToken) => {
    if (!bearerToken) {
      return undefined;
    }

    try {
      const principal = await authenticateApiKey(bearerToken);

      return {
        clientId: principal.apiKeyId,
        extra: principal,
        scopes: [
          "quotes:create",
          "quotes:accept",
          "tasks:read",
        ],
        token: bearerToken,
      };
    } catch {
      return undefined;
    }
  },
  { required: true },
);

export {
  authenticatedHandler as GET,
  authenticatedHandler as POST,
};
