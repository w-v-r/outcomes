import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const PINCH_AUTH_URL = "https://auth.getpinch.com.au/connect/token";
const PINCH_TEST_API_URL = "https://api.getpinch.com.au/test";
const PINCH_WEBHOOK_PATH = "/api/webhooks/pinch";
const LOCAL_ENV_PATH = ".env";
const VERCEL_ENVIRONMENT = "production";
const WEBHOOK_EVENT_TYPES = ["realtime-payment"];

const requiredDeploymentVariables = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "PINCH_APPLICATION_ID",
  "PINCH_APPLICATION_SECRET",
  "NEXT_PUBLIC_PINCH_PUBLISHABLE_KEY",
  "PINCH_ENVIRONMENT",
  "PINCH_API_VERSION",
  "PINCH_WEBHOOK_SECRET",
];

const sensitiveDeploymentVariables = new Set([
  "SUPABASE_SECRET_KEY",
  "PINCH_APPLICATION_SECRET",
  "PINCH_WEBHOOK_SECRET",
]);

const getRequiredEnvironmentVariable = (name) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const runCommand = (command, arguments_, input) => {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    input,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}.`);
  }

  return result.stdout;
};

const getSupabaseSecretKey = () => {
  const currentSecret = process.env.SUPABASE_SECRET_KEY?.trim();

  if (currentSecret) {
    return currentSecret;
  }

  const output = runCommand("npx", [
    "--yes",
    "supabase@latest",
    "projects",
    "api-keys",
    "--reveal",
    "--output",
    "json",
  ]);
  const apiKeys = JSON.parse(output);
  const secretKey = apiKeys.find(({ type }) => type === "secret")?.api_key;

  if (!secretKey) {
    throw new Error("Supabase returned no sb_secret API key.");
  }

  return secretKey;
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
    throw new Error(`Pinch authentication failed with status ${response.status}.`);
  }

  const token = await response.json();

  if (!token.access_token) {
    throw new Error("Pinch authentication returned no access token.");
  }

  return token.access_token;
};

const pinchRequest = async (path, accessToken, options = {}) => {
  const apiVersion = process.env.PINCH_API_VERSION?.trim() || "2020.1";
  const response = await fetch(`${PINCH_TEST_API_URL}${path}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "pinch-version": apiVersion,
    },
    method: options.method || "GET",
  });

  if (!response.ok) {
    throw new Error(
      `Pinch ${options.method || "GET"} ${path} failed with status ${response.status}.`,
    );
  }

  const responseText = await response.text();

  return responseText ? JSON.parse(responseText) : null;
};

const configurePinchWebhook = async (webhookUrl, shouldRecreate) => {
  const accessToken = await getPinchAccessToken();
  const webhooks = await pinchRequest("/webhooks", accessToken);
  const matchingWebhook = webhooks.find(({ uri }) => uri === webhookUrl);
  const managedWebhooks = webhooks.filter(({ uri }) => {
    try {
      return new URL(uri).pathname === PINCH_WEBHOOK_PATH;
    } catch {
      return false;
    }
  });

  if (!matchingWebhook && managedWebhooks.length > 1) {
    throw new Error(
      "Multiple Pinch webhooks use the application callback path. Remove duplicates before reconfiguring.",
    );
  }

  let existingWebhook = matchingWebhook ?? managedWebhooks[0];

  if (shouldRecreate && existingWebhook) {
    await pinchRequest(
      `/webhooks/${encodeURIComponent(existingWebhook.id)}`,
      accessToken,
      { method: "DELETE" },
    );
    existingWebhook = null;
  }

  return pinchRequest("/webhooks", accessToken, {
    body: {
      eventTypes: WEBHOOK_EVENT_TYPES,
      id: existingWebhook?.id,
      uri: webhookUrl,
      webhookFormat: "camel-case",
    },
    method: "POST",
  });
};

const upsertLocalEnvironmentVariable = (name, value) => {
  const currentContents = readFileSync(LOCAL_ENV_PATH, "utf8");
  const environmentLine = `${name}=${value}`;
  const linePattern = new RegExp(`^${name}=.*$`, "m");
  const nextContents = linePattern.test(currentContents)
    ? currentContents.replace(linePattern, environmentLine)
    : `${currentContents.trimEnd()}\n${environmentLine}\n`;

  writeFileSync(LOCAL_ENV_PATH, nextContents, { mode: 0o600 });
  process.env[name] = value;
};

const syncVercelEnvironmentVariable = (name) => {
  const value = getRequiredEnvironmentVariable(name);
  const sensitivityFlag = sensitiveDeploymentVariables.has(name)
    ? "--sensitive"
    : "--no-sensitive";

  runCommand(
    "npx",
    [
      "--yes",
      "vercel@latest",
      "env",
      "add",
      name,
      VERCEL_ENVIRONMENT,
      "--force",
      "--yes",
      sensitivityFlag,
    ],
    `${value}\n`,
  );
};

const getWebhookUrl = () => {
  const urlArgument = process.argv[2];

  if (!urlArgument) {
    throw new Error(
      "Usage: npm run pinch:webhook:configure -- https://example.com/api/webhooks/pinch",
    );
  }

  const webhookUrl = new URL(urlArgument);

  if (webhookUrl.protocol !== "https:") {
    throw new Error("The Pinch webhook URL must use HTTPS.");
  }

  if (webhookUrl.pathname !== PINCH_WEBHOOK_PATH) {
    throw new Error(`The Pinch webhook URL must end in ${PINCH_WEBHOOK_PATH}.`);
  }

  return webhookUrl.toString();
};

const main = async () => {
  process.loadEnvFile(LOCAL_ENV_PATH);

  if (getRequiredEnvironmentVariable("PINCH_ENVIRONMENT") !== "test") {
    throw new Error("Webhook setup is locked to PINCH_ENVIRONMENT=test.");
  }

  const webhookUrl = getWebhookUrl();
  const shouldRecreate = process.argv.includes("--recreate");
  const supabaseSecretKey = getSupabaseSecretKey();
  upsertLocalEnvironmentVariable("SUPABASE_SECRET_KEY", supabaseSecretKey);

  const webhook = await configurePinchWebhook(webhookUrl, shouldRecreate);

  if (!webhook.id || !webhook.secret) {
    throw new Error("Pinch returned an incomplete webhook configuration.");
  }

  upsertLocalEnvironmentVariable("PINCH_WEBHOOK_SECRET", webhook.secret);

  for (const name of requiredDeploymentVariables) {
    syncVercelEnvironmentVariable(name);
  }

  console.log(
    `Configured Pinch webhook ${webhook.id} at ${webhook.uri || webhookUrl}.`,
  );
  console.log(
    `Synced ${requiredDeploymentVariables.length} variables to Vercel ${VERCEL_ENVIRONMENT}.`,
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Webhook setup failed.");
  process.exitCode = 1;
});
