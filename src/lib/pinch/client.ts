import "server-only";

const PINCH_AUTH_URL = "https://auth.getpinch.com.au/connect/token";
const PINCH_TEST_API_URL = "https://api.getpinch.com.au/test";
const PINCH_REQUEST_TIMEOUT_MS = 15_000;

type PinchAccessToken = {
  accessToken: string;
  expiresAt: number;
};

type PinchErrorBody = {
  error?: string;
  error_description?: string;
  message?: string;
  title?: string;
};

export type PinchPayer = {
  id: string;
  firstName: string;
  lastName: string | null;
  emailAddress: string;
  companyName: string | null;
};

export type PinchPaymentSource = {
  id: string;
  sourceType: "bank-account" | "credit-card";
  cardHolderName: string | null;
  displayCardNumber: string | null;
  cardScheme: string | null;
  expiryDate: string | null;
};

export type PinchPayment = {
  id: string;
  attemptId: string | null;
  amount: number;
  currency: string;
  status: string;
  sourceType: string | null;
  transactionDate: string | null;
  estimatedTransferDate: string | null;
  dishonour?: {
    code?: string;
    message?: string;
  } | null;
};

export type PinchPaymentNonceResult = {
  data: PinchPayment | null;
  isNonceReplay: boolean;
  nonce: string;
};

export type CreatePinchPayerInput = {
  companyName?: string;
  emailAddress: string;
  firstName: string;
  lastName: string;
  metadata: Record<string, string>;
};

export type CreateRealtimePaymentInput = {
  amountCents: number;
  description: string;
  metadata: Record<string, string>;
  nonce: string;
  payerId: string;
  sourceId: string;
};

export class PinchApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PinchApiError";
    this.status = status;
  }
}

let cachedAccessToken: PinchAccessToken | null = null;

const getPinchConfig = () => {
  const applicationId = process.env.PINCH_APPLICATION_ID;
  const applicationSecret = process.env.PINCH_APPLICATION_SECRET;
  const environment = process.env.PINCH_ENVIRONMENT;
  const apiVersion = process.env.PINCH_API_VERSION ?? "2020.1";

  if (!applicationId || !applicationSecret) {
    throw new Error(
      "Missing PINCH_APPLICATION_ID or PINCH_APPLICATION_SECRET.",
    );
  }

  if (environment !== "test") {
    throw new Error(
      "This build is locked to Pinch test mode. Set PINCH_ENVIRONMENT=test.",
    );
  }

  return {
    apiVersion,
    applicationId,
    applicationSecret,
  };
};

const getErrorMessage = async (response: Response) => {
  const fallbackMessage = `Pinch request failed with status ${response.status}.`;

  try {
    const body = (await response.json()) as PinchErrorBody | PinchErrorBody[];
    const errorBody = Array.isArray(body) ? body[0] : body;

    return (
      errorBody?.message ??
      errorBody?.error_description ??
      errorBody?.title ??
      errorBody?.error ??
      fallbackMessage
    );
  } catch {
    return fallbackMessage;
  }
};

const requestAccessToken = async () => {
  const { applicationId, applicationSecret } = getPinchConfig();
  const credentials = Buffer.from(
    `${applicationId}:${applicationSecret}`,
  ).toString("base64");
  const response = await fetch(PINCH_AUTH_URL, {
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    cache: "no-store",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    signal: AbortSignal.timeout(PINCH_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new PinchApiError(await getErrorMessage(response), response.status);
  }

  const token = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!token.access_token) {
    throw new PinchApiError(
      "Pinch authentication returned no access token.",
      response.status,
    );
  }

  cachedAccessToken = {
    accessToken: token.access_token,
    expiresAt: Date.now() + Math.max((token.expires_in ?? 3600) - 60, 60) * 1000,
  };

  return cachedAccessToken.accessToken;
};

const getAccessToken = async () => {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.accessToken;
  }

  return requestAccessToken();
};

type PinchRequestOptions = {
  body?: Record<string, unknown>;
  method?: "GET" | "POST";
};

const pinchRequest = async <ResponseBody>(
  path: string,
  options: PinchRequestOptions = {},
): Promise<ResponseBody> => {
  const [{ apiVersion }, accessToken] = await Promise.all([
    Promise.resolve(getPinchConfig()),
    getAccessToken(),
  ]);
  const response = await fetch(`${PINCH_TEST_API_URL}${path}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "pinch-version": apiVersion,
    },
    method: options.method ?? "GET",
    signal: AbortSignal.timeout(PINCH_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new PinchApiError(await getErrorMessage(response), response.status);
  }

  if (response.status === 204) {
    return undefined as ResponseBody;
  }

  const responseText = await response.text();

  if (!responseText) {
    return undefined as ResponseBody;
  }

  return JSON.parse(responseText) as ResponseBody;
};

export const checkPinchAuthHealth = async () => {
  await pinchRequest<void>("/health/auth");
};

export const createPinchPayer = async ({
  companyName,
  emailAddress,
  firstName,
  lastName,
  metadata,
}: CreatePinchPayerInput) =>
  pinchRequest<PinchPayer>("/payers", {
    body: {
      companyName: companyName || undefined,
      emailAddress,
      firstName,
      lastName,
      metadata: JSON.stringify(metadata),
    },
    method: "POST",
  });

export const createPinchPaymentSource = async (
  payerId: string,
  captureToken: string,
) =>
  pinchRequest<PinchPaymentSource>(
    `/payers/${encodeURIComponent(payerId)}/sources`,
    {
      body: {
        sourceType: "credit-card",
        token: captureToken,
      },
      method: "POST",
    },
  );

export const createPinchRealtimePayment = async ({
  amountCents,
  description,
  metadata,
  nonce,
  payerId,
  sourceId,
}: CreateRealtimePaymentInput) =>
  pinchRequest<PinchPayment>("/payments/realtime", {
    body: {
      amount: amountCents,
      description,
      metadata: JSON.stringify(metadata),
      nonce,
      payerId,
      sourceId,
    },
    method: "POST",
  });

export const checkPinchPaymentNonce = async (nonce: string) =>
  pinchRequest<PinchPaymentNonceResult>("/payments/nonce", {
    body: { nonce },
    method: "POST",
  });
