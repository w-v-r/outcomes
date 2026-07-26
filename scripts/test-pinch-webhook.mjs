import { createHmac } from "node:crypto";

const LOCAL_ENV_PATH = ".env";
const TEST_PAYMENT_ID = "pmt_webhook_smoke_test";

const getRequiredEnvironmentVariable = (name) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const createSignature = (rawBody, secret) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return `t=${timestamp},v2=${signature}`;
};

const postWebhook = async (webhookUrl, rawBody, webhookSecret) => {
  const response = await fetch(webhookUrl, {
    body: rawBody,
    headers: {
      "Content-Type": "application/json",
      "pinch-signature": createSignature(rawBody, webhookSecret),
    },
    method: "POST",
  });
  const responseBody = await response.json();

  if (!response.ok) {
    throw new Error(`Webhook returned status ${response.status}.`);
  }

  return responseBody;
};

const requestSupabase = async (path, options = {}) => {
  const supabaseUrl = getRequiredEnvironmentVariable(
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const supabaseSecretKey = getRequiredEnvironmentVariable(
    "SUPABASE_SECRET_KEY",
  );
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseSecretKey,
      Authorization: `Bearer ${supabaseSecretKey}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase request returned status ${response.status}.`);
  }

  return response;
};

const getRecordedEvent = async (eventId) => {
  const query = new URLSearchParams({
    provider_event_id: `eq.${eventId}`,
    select: "provider_event_id,processed_at,processing_error",
  });
  const response = await requestSupabase(`webhook_events?${query}`);
  const events = await response.json();

  return events[0] ?? null;
};

const deleteRecordedEvent = async (eventId) => {
  const query = new URLSearchParams({
    provider_event_id: `eq.${eventId}`,
  });

  await requestSupabase(`webhook_events?${query}`, { method: "DELETE" });
};

const main = async () => {
  process.loadEnvFile(LOCAL_ENV_PATH);

  const webhookUrl = process.argv[2];

  if (!webhookUrl) {
    throw new Error(
      "Usage: npm run pinch:webhook:test -- https://example.com/api/webhooks/pinch",
    );
  }

  const eventId = `evt_webhook_smoke_${Date.now()}`;
  const rawBody = JSON.stringify({
    data: {
      payment: {
        id: TEST_PAYMENT_ID,
        status: "approved",
      },
    },
    eventDate: new Date().toISOString(),
    id: eventId,
    metadata: { source: "local-smoke-test" },
    type: "realtime-payment",
  });
  const webhookSecret = getRequiredEnvironmentVariable(
    "PINCH_WEBHOOK_SECRET",
  );

  try {
    const firstDelivery = await postWebhook(
      webhookUrl,
      rawBody,
      webhookSecret,
    );

    if (firstDelivery.received !== true) {
      throw new Error("The first webhook delivery was not acknowledged.");
    }

    const duplicateDelivery = await postWebhook(
      webhookUrl,
      rawBody,
      webhookSecret,
    );

    if (
      duplicateDelivery.received !== true ||
      duplicateDelivery.duplicate !== true
    ) {
      throw new Error("The duplicate webhook delivery was not deduplicated.");
    }

    const recordedEvent = await getRecordedEvent(eventId);

    if (
      !recordedEvent?.processed_at ||
      recordedEvent.processing_error !== null
    ) {
      throw new Error("Supabase did not record a successfully processed event.");
    }

    console.log("Webhook signature, persistence, and deduplication passed.");
  } finally {
    await deleteRecordedEvent(eventId);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Webhook test failed.");
  process.exitCode = 1;
});
