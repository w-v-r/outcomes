const LOCAL_ENV_PATH = ".env";
const PINCH_AUTH_URL = "https://auth.getpinch.com.au/connect/token";
const PINCH_TEST_API_URL = "https://api.getpinch.com.au/test";
const MOCK_PRICE_CENTS = 1375;
const WEBHOOK_WAIT_ATTEMPTS = 20;
const WEBHOOK_WAIT_INTERVAL_MS = 1_000;

const getRequiredEnvironmentVariable = (name) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
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
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();

    throw new Error(
      `Supabase ${options.method || "GET"} ${path} returned ${response.status}: ${errorBody}`,
    );
  }

  if (response.status === 204) {
    return null;
  }

  const responseText = await response.text();

  return responseText ? JSON.parse(responseText) : null;
};

const insertRow = async (table, row) => {
  const rows = await requestSupabase(table, {
    body: JSON.stringify(row),
    headers: { Prefer: "return=representation" },
    method: "POST",
  });

  if (!rows?.[0]) {
    throw new Error(`Supabase did not return the inserted ${table} row.`);
  }

  return rows[0];
};

const updateRows = async (table, query, changes) =>
  requestSupabase(`${table}?${query}`, {
    body: JSON.stringify(changes),
    headers: { Prefer: "return=minimal" },
    method: "PATCH",
  });

const getReadyBillingContext = async () => {
  const billingQuery = new URLSearchParams({
    limit: "2",
    select: "id,user_id,provider_payer_id",
    status: "eq.ready",
  });
  const billingAccounts = await requestSupabase(
    `billing_accounts?${billingQuery}`,
  );

  if (billingAccounts.length !== 1) {
    throw new Error(
      `Expected exactly one ready sandbox billing account, found ${billingAccounts.length}.`,
    );
  }

  const billingAccount = billingAccounts[0];
  const sourceQuery = new URLSearchParams({
    billing_account_id: `eq.${billingAccount.id}`,
    is_default: "eq.true",
    limit: "1",
    select: "id,provider_source_id",
    user_id: `eq.${billingAccount.user_id}`,
  });
  const paymentSources = await requestSupabase(
    `payment_sources?${sourceQuery}`,
  );

  if (!paymentSources[0]) {
    throw new Error("The sandbox billing account has no default payment source.");
  }

  return {
    billingAccount,
    paymentSource: paymentSources[0],
  };
};

const getPinchAccessToken = async () => {
  const applicationId = getRequiredEnvironmentVariable(
    "PINCH_APPLICATION_ID",
  );
  const applicationSecret = getRequiredEnvironmentVariable(
    "PINCH_APPLICATION_SECRET",
  );
  const credentials = Buffer.from(
    `${applicationId}:${applicationSecret}`,
  ).toString("base64");
  const response = await fetch(PINCH_AUTH_URL, {
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Pinch authentication returned ${response.status}.`);
  }

  const token = await response.json();

  if (!token.access_token) {
    throw new Error("Pinch authentication returned no access token.");
  }

  return token.access_token;
};

const createPinchPayment = async ({
  amountCents,
  nonce,
  payerId,
  quoteId,
  sourceId,
  taskId,
  userId,
}) => {
  const accessToken = await getPinchAccessToken();
  const apiVersion = getRequiredEnvironmentVariable("PINCH_API_VERSION");
  const response = await fetch(`${PINCH_TEST_API_URL}/payments/realtime`, {
    body: JSON.stringify({
      amount: amountCents,
      description: "Outcomes: Mock worker completion proof",
      metadata: JSON.stringify({
        invocation: "mock-mcp-worker",
        outcomesQuoteId: quoteId,
        outcomesTaskId: taskId,
        outcomesUserId: userId,
        pricingModel: "mock-pricing-v1",
      }),
      nonce,
      payerId,
      sourceId,
    }),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "pinch-version": apiVersion,
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Pinch realtime payment returned ${response.status}.`);
  }

  return response.json();
};

const wait = (durationMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const waitForPinchWebhook = async (providerPaymentId) => {
  for (let attempt = 0; attempt < WEBHOOK_WAIT_ATTEMPTS; attempt += 1) {
    const query = new URLSearchParams({
      event_type: "eq.realtime-payment",
      limit: "1",
      order: "received_at.desc",
      provider_payment_id: `eq.${providerPaymentId}`,
      select: "provider_event_id,processed_at,processing_error",
    });
    const events = await requestSupabase(`webhook_events?${query}`);
    const event = events[0];

    if (event?.processed_at && !event.processing_error) {
      return event;
    }

    await wait(WEBHOOK_WAIT_INTERVAL_MS);
  }

  throw new Error(
    "Pinch did not deliver a processed realtime-payment webhook within 20 seconds.",
  );
};

const main = async () => {
  process.loadEnvFile(LOCAL_ENV_PATH);

  if (getRequiredEnvironmentVariable("PINCH_ENVIRONMENT") !== "test") {
    throw new Error("The mock worker is locked to PINCH_ENVIRONMENT=test.");
  }

  const { billingAccount, paymentSource } = await getReadyBillingContext();
  const approvedAt = new Date().toISOString();
  const task = await insertRow("tasks", {
    acceptance_criteria:
      "The mock worker returns verified completion evidence before billing.",
    description:
      "A scripted MCP-style invocation using mocked pricing and worker outputs.",
    status: "quoted",
    title: "Mock MCP worker payment verification",
    user_id: billingAccount.user_id,
  });
  const quote = await insertRow("quotes", {
    amount_cents: MOCK_PRICE_CENTS,
    approved_at: approvedAt,
    currency: "AUD",
    pricing_model_version: "mock-pricing-v1",
    status: "approved",
    task_id: task.id,
    terms:
      "Charge the fixed sandbox price only after the mock worker verifies completion.",
    user_id: billingAccount.user_id,
  });

  await updateRows(
    "tasks",
    new URLSearchParams({ id: `eq.${task.id}` }),
    { status: "approved" },
  );
  await updateRows(
    "tasks",
    new URLSearchParams({ id: `eq.${task.id}` }),
    { status: "executing" },
  );

  const verifiedAt = new Date().toISOString();
  await updateRows(
    "tasks",
    new URLSearchParams({ id: `eq.${task.id}` }),
    { status: "verified", verified_at: verifiedAt },
  );

  const nonce = `outcomes-task-${task.id}-charge-v1`;
  const payment = await insertRow("payments", {
    amount_cents: quote.amount_cents,
    billing_account_id: billingAccount.id,
    currency: quote.currency,
    environment: "test",
    nonce,
    payment_source_id: paymentSource.id,
    provider: "pinch",
    quote_id: quote.id,
    status: "submitting",
    task_id: task.id,
    user_id: billingAccount.user_id,
  });
  const pinchPayment = await createPinchPayment({
    amountCents: quote.amount_cents,
    nonce,
    payerId: billingAccount.provider_payer_id,
    quoteId: quote.id,
    sourceId: paymentSource.provider_source_id,
    taskId: task.id,
    userId: billingAccount.user_id,
  });
  const normalizedStatus = pinchPayment.status.toLowerCase();
  const paymentStatus = ["approved", "pending"].includes(normalizedStatus)
    ? normalizedStatus
    : "failed";
  const completedAt = new Date().toISOString();

  await updateRows(
    "payments",
    new URLSearchParams({ id: `eq.${payment.id}` }),
    {
      charged_at: completedAt,
      failure_code: pinchPayment.dishonour?.code ?? null,
      failure_message: pinchPayment.dishonour?.message ?? null,
      provider_attempt_id: pinchPayment.attemptId,
      provider_payment_id: pinchPayment.id,
      status: paymentStatus,
    },
  );
  await updateRows(
    "tasks",
    new URLSearchParams({ id: `eq.${task.id}` }),
    { completed_at: completedAt, status: "completed" },
  );

  if (paymentStatus === "failed") {
    throw new Error(`Pinch returned unsuccessful status ${pinchPayment.status}.`);
  }

  const webhookEvent = await waitForPinchWebhook(pinchPayment.id);

  console.log(`Mock pricing produced AUD ${(MOCK_PRICE_CENTS / 100).toFixed(2)}.`);
  console.log(`Mock worker verified task ${task.id}.`);
  console.log(
    `Pinch sandbox payment ${pinchPayment.id} returned ${pinchPayment.status}.`,
  );
  console.log(
    `Pinch webhook ${webhookEvent.provider_event_id} was processed by Outcomes.`,
  );
};

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Mock worker payment test failed.",
  );
  process.exitCode = 1;
});
