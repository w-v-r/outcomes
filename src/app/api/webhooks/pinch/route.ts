import {
  parsePinchWebhookEvent,
  verifyPinchWebhookSignature,
} from "@/lib/pinch/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const getPaymentStatus = (pinchStatus: string | null) => {
  const normalizedStatus = pinchStatus?.toLowerCase();

  if (normalizedStatus === "approved") {
    return "approved";
  }

  if (normalizedStatus === "pending" || normalizedStatus === "submitted") {
    return "pending";
  }

  if (normalizedStatus === "settled") {
    return "settled";
  }

  if (
    normalizedStatus === "dishonoured" ||
    normalizedStatus === "declined" ||
    normalizedStatus === "failed" ||
    normalizedStatus === "rejected"
  ) {
    return "failed";
  }

  return null;
};

export const POST = async (request: Request) => {
  const webhookSecret = process.env.PINCH_WEBHOOK_SECRET;
  const supabase = createAdminClient();

  if (!webhookSecret || !supabase) {
    return Response.json(
      { error: "Webhook processing is not configured." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const signatureIsValid = verifyPinchWebhookSignature(
    rawBody,
    request.headers.get("pinch-signature"),
    webhookSecret,
  );

  if (!signatureIsValid) {
    return Response.json(
      { error: "Invalid Pinch signature." },
      { status: 401 },
    );
  }

  try {
    const event = parsePinchWebhookEvent(rawBody);

    if (!event) {
      return Response.json(
        { error: "Invalid Pinch event payload." },
        { status: 400 },
      );
    }

    const { error: eventInsertError } = await supabase
      .from("webhook_events")
      .insert({
        event_type: event.type,
        occurred_at: event.eventDate,
        provider: "pinch",
        provider_event_id: event.id,
        provider_payment_id: event.payments[0]?.id ?? null,
      });

    if (eventInsertError?.code === "23505") {
      return Response.json({ duplicate: true, received: true });
    }

    if (eventInsertError) {
      return Response.json(
        { error: "Webhook event could not be recorded." },
        { status: 500 },
      );
    }

    const paymentUpdateErrors: string[] = [];

    for (const payment of event.payments) {
      const status = getPaymentStatus(payment.status);

      if (!status) {
        continue;
      }

      const paymentUpdate =
        status === "settled"
          ? { settled_at: new Date().toISOString(), status }
          : { status };
      const { error: paymentUpdateError } = await supabase
        .from("payments")
        .update(paymentUpdate)
        .eq("provider_payment_id", payment.id);

      if (paymentUpdateError) {
        paymentUpdateErrors.push(payment.id);
      }
    }

    const processingError =
      paymentUpdateErrors.length > 0
        ? `Could not update payments: ${paymentUpdateErrors.join(", ")}`
        : null;
    await supabase
      .from("webhook_events")
      .update({
        processed_at: new Date().toISOString(),
        processing_error: processingError,
      })
      .eq("provider_event_id", event.id);

    if (processingError) {
      return Response.json(
        { error: "Webhook reconciliation was incomplete." },
        { status: 500 },
      );
    }

    return Response.json({ received: true });
  } catch {
    return Response.json(
      { error: "Pinch webhook payload could not be processed." },
      { status: 400 },
    );
  }
};
