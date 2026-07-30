import { randomUUID, timingSafeEqual } from "node:crypto";

import { reconcileControlPlane } from "@/lib/control-plane/reconciliation";

export const runtime = "nodejs";
export const maxDuration = 800;

const parseBatchSize = (): number => {
  const configured = Number(process.env.OUTCOMES_EXECUTION_BATCH_SIZE ?? "1");

  if (!Number.isSafeInteger(configured)) {
    return 1;
  }

  return Math.max(1, Math.min(configured, 3));
};

export const isAuthorizedInternalRequest = (request: Request): boolean => {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");

  if (!secret || !authorization) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);

  return (
    expected.length === actual.length &&
    timingSafeEqual(expected, actual)
  );
};

export const getReconciliationHttpStatus = (partial: boolean): 200 | 207 =>
  partial ? 207 : 200;

export const GET = async (request: Request) => {
  if (!isAuthorizedInternalRequest(request)) {
    return Response.json(
      {
        error: {
          code: "unauthorized",
          message: "The internal execution trigger is unauthorized.",
        },
      },
      {
        headers: { "Cache-Control": "no-store" },
        status: 401,
      },
    );
  }

  try {
    const result = await reconcileControlPlane({
      batchSize: parseBatchSize(),
      claimedBy: `cron:${randomUUID()}`,
    });

    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
      status: getReconciliationHttpStatus(result.partial),
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "reconciliation_failed",
          message: "Task execution reconciliation failed.",
        },
      },
      {
        headers: { "Cache-Control": "no-store" },
        status: 500,
      },
    );
  }
};

export const POST = GET;
