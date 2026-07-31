import { createHash, randomUUID } from "node:crypto";

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

const callRpc = async (name, parameters) =>
  requestSupabase(`rpc/${name}`, {
    body: JSON.stringify(parameters),
    method: "POST",
  });

const getReadyBillingContext = async () => {
  const billingQuery = new URLSearchParams({
    limit: "100",
    order: "created_at.desc",
    select: "id,user_id,provider_payer_id",
    status: "eq.ready",
  });
  const billingAccounts = await requestSupabase(
    `billing_accounts?${billingQuery}`,
  );

  if (billingAccounts.length === 0) {
    throw new Error(
      "Expected at least one ready sandbox billing account.",
    );
  }

  let billingAccount = billingAccounts[0];

  if (billingAccounts.length > 1) {
    const paymentsQuery = new URLSearchParams({
      limit: "100",
      order: "created_at.desc",
      select: "user_id",
    });
    const payments = await requestSupabase(`payments?${paymentsQuery}`);
    const recentUserId = payments.find((payment) =>
      billingAccounts.some(
        (account) => account.user_id === payment.user_id,
      ),
    )?.user_id;

    billingAccount =
      billingAccounts.find((account) => account.user_id === recentUserId) ??
      billingAccount;
  }
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
  accrualCount,
  amountCents,
  nonce,
  payerId,
  paymentId,
  sourceId,
  userId,
}) => {
  const accessToken = await getPinchAccessToken();
  const apiVersion = getRequiredEnvironmentVariable("PINCH_API_VERSION");
  const response = await fetch(`${PINCH_TEST_API_URL}/payments/realtime`, {
    body: JSON.stringify({
      amount: amountCents,
      description: "Outcomes: Mock worker completion proof",
      metadata: JSON.stringify({
        outcomesAccrualCount: String(accrualCount),
        outcomesPaymentId: paymentId,
        invocation: "mock-mcp-worker",
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

  const { billingAccount } = await getReadyBillingContext();
  const approvedAt = new Date().toISOString();
  const repositorySha = "0".repeat(40);
  const repositoryUrl = "legacy://mock-worker-payment";
  const taskSpec = {
    acceptanceCriteria: [
      "The mock worker returns verified completion evidence before billing.",
    ],
    description:
      "A scripted MCP-style invocation using mocked pricing and worker outputs.",
    prohibitedChanges: [],
  };
  const task = await insertRow("tasks", {
    acceptance_criteria:
      "The mock worker returns verified completion evidence before billing.",
    description:
      "A scripted MCP-style invocation using mocked pricing and worker outputs.",
    external_ref: `mock-worker-${randomUUID()}`,
    idempotency_key: `mock-worker-${randomUUID()}`,
    repository_sha: repositorySha,
    repository_url: repositoryUrl,
    status: "quoted",
    task_spec: taskSpec,
    title: "Mock MCP worker payment verification",
    user_id: billingAccount.user_id,
  });
  const quote = await insertRow("quotes", {
    acceptance_idempotency_key: `mock-acceptance-${randomUUID()}`,
    accepted_at: approvedAt,
    amount_cents: MOCK_PRICE_CENTS,
    approved_at: approvedAt,
    contract_hash: createHash("sha256")
      .update(JSON.stringify({ taskId: task.id, taskSpec }))
      .digest("hex"),
    currency: "AUD",
    eligibility_decision: { eligible: true },
    expires_at: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    pricing_model_version: "mock-pricing-v1",
    repository_sha: repositorySha,
    repository_url: repositoryUrl,
    request_id: `mock-request-${randomUUID()}`,
    status: "approved",
    task_id: task.id,
    task_spec: taskSpec,
    terms:
      "Accrue after verified completion and batch-charge the stored payment method when the outstanding balance reaches AUD $10.",
    user_id: billingAccount.user_id,
  });

  await updateRows(
    "tasks",
    new URLSearchParams({ id: `eq.${task.id}` }),
    {
      quote_id: quote.id,
      status: "approved",
    },
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

  const [accrual] = await callRpc("accrue_verified_task", {
    p_task_id: task.id,
  });
  const [claim] = await callRpc("claim_billing_accruals", {
    p_threshold_cents: 1000,
    p_user_id: billingAccount.user_id,
  });

  if (!accrual || !claim) {
    throw new Error("The verified task did not produce a settlement claim.");
  }

  const paymentQuery = new URLSearchParams({
    id: `eq.${claim.payment_id}`,
    limit: "1",
    select:
      "id,amount_cents,currency,nonce,provider_payer_id_snapshot,provider_source_id_snapshot",
  });
  const [payment] = await requestSupabase(`payments?${paymentQuery}`);

  if (!payment || payment.amount_cents !== claim.amount_cents) {
    throw new Error("The claimed payment does not match the accrued balance.");
  }

  await updateRows(
    "payments",
    new URLSearchParams({ id: `eq.${payment.id}` }),
    { status: "submitting" },
  );

  const pinchPayment = await createPinchPayment({
    accrualCount: claim.accrual_count,
    amountCents: payment.amount_cents,
    nonce: payment.nonce,
    payerId: payment.provider_payer_id_snapshot,
    paymentId: payment.id,
    sourceId: payment.provider_source_id_snapshot,
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
  if (paymentStatus === "failed") {
    throw new Error(`Pinch returned unsuccessful status ${pinchPayment.status}.`);
  }

  let webhookEvent = null;

  try {
    webhookEvent = await waitForPinchWebhook(pinchPayment.id);
  } catch (error) {
    console.warn(
      error instanceof Error
        ? error.message
        : "Pinch webhook confirmation was unavailable.",
    );
  }

  console.log(`Mock pricing produced AUD ${(MOCK_PRICE_CENTS / 100).toFixed(2)}.`);
  console.log(`Mock worker verified and accrued task ${task.id}.`);
  console.log(
    `Pinch sandbox payment ${pinchPayment.id} returned ${pinchPayment.status}.`,
  );
  if (webhookEvent) {
    console.log(
      `Pinch webhook ${webhookEvent.provider_event_id} was processed by Outcomes.`,
    );
  }
};

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Mock worker payment test failed.",
  );
  process.exitCode = 1;
});
