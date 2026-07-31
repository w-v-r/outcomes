import { settleOutstandingBalances } from "@/lib/billing/charge-outstanding-balance";
import { isAuthorizedInternalRequest } from "@/lib/control-plane/internal-request";

export const runtime = "nodejs";
export const maxDuration = 800;

const parseBatchSize = (): number => {
  const configured = Number(process.env.OUTCOMES_BILLING_BATCH_SIZE ?? "25");

  if (!Number.isSafeInteger(configured)) {
    return 25;
  }

  return Math.max(1, Math.min(configured, 100));
};

export const GET = async (request: Request) => {
  if (!isAuthorizedInternalRequest(request)) {
    return Response.json(
      {
        error: {
          code: "unauthorized",
          message: "The internal billing trigger is unauthorized.",
        },
      },
      {
        headers: { "Cache-Control": "no-store" },
        status: 401,
      },
    );
  }

  try {
    const result = await settleOutstandingBalances({
      batchSize: parseBatchSize(),
    });

    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
      status: result.failed > 0 ? 207 : 200,
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "settlement_failed",
          message: "Accrued billing settlement failed.",
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
