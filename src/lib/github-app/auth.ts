import {
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
  timingSafeEqual,
} from "node:crypto";

const GITHUB_APP_JWT_LIFETIME_SECONDS = 9 * 60;
const GITHUB_APP_JWT_CLOCK_SKEW_SECONDS = 60;
const INSTALLATION_STATE_LIFETIME_SECONDS = 10 * 60;

const encodeBase64Url = (value: string | Buffer): string =>
  Buffer.from(value).toString("base64url");

const decodeBase64UrlJson = (value: string): unknown =>
  JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;

const signState = (payload: string, secret: string): Buffer =>
  createHmac("sha256", secret).update(payload).digest();

export const createGitHubAppJwt = ({
  appId,
  now = new Date(),
  privateKey,
}: {
  appId: number;
  now?: Date;
  privateKey: string;
}): string => {
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const header = encodeBase64Url(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  );
  const payload = encodeBase64Url(
    JSON.stringify({
      exp: issuedAt + GITHUB_APP_JWT_LIFETIME_SECONDS,
      iat: issuedAt - GITHUB_APP_JWT_CLOCK_SKEW_SECONDS,
      iss: appId,
    }),
  );
  const unsignedToken = `${header}.${payload}`;
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(unsignedToken),
    createPrivateKey(privateKey),
  );

  return `${unsignedToken}.${encodeBase64Url(signature)}`;
};

type InstallationStatePayload = {
  expiresAt: number;
  nonce: string;
  returnTo: string;
  userId: string;
};

const isSafeReturnPath = (value: string): boolean =>
  value.startsWith("/") && !value.startsWith("//");

export const createGitHubInstallationState = ({
  now = new Date(),
  returnTo = "/console",
  secret,
  userId,
}: {
  now?: Date;
  returnTo?: string;
  secret: string;
  userId: string;
}): string => {
  if (!isSafeReturnPath(returnTo)) {
    throw new Error("GitHub installation return path must be relative.");
  }

  const payload = encodeBase64Url(
    JSON.stringify({
      expiresAt:
        Math.floor(now.getTime() / 1_000) +
        INSTALLATION_STATE_LIFETIME_SECONDS,
      nonce: randomBytes(16).toString("base64url"),
      returnTo,
      userId,
    } satisfies InstallationStatePayload),
  );
  const signature = signState(payload, secret);

  return `${payload}.${encodeBase64Url(signature)}`;
};

export const verifyGitHubInstallationState = ({
  expectedUserId,
  now = new Date(),
  secret,
  state,
}: {
  expectedUserId: string;
  now?: Date;
  secret: string;
  state: string;
}): InstallationStatePayload => {
  const [payload, encodedSignature, extraPart] = state.split(".");

  if (!payload || !encodedSignature || extraPart !== undefined) {
    throw new Error("GitHub installation state is malformed.");
  }

  const suppliedSignature = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = signState(payload, secret);

  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new Error("GitHub installation state signature is invalid.");
  }

  const decodedPayload = decodeBase64UrlJson(payload);

  if (
    typeof decodedPayload !== "object" ||
    decodedPayload === null ||
    !("expiresAt" in decodedPayload) ||
    typeof decodedPayload.expiresAt !== "number" ||
    !("nonce" in decodedPayload) ||
    typeof decodedPayload.nonce !== "string" ||
    !("returnTo" in decodedPayload) ||
    typeof decodedPayload.returnTo !== "string" ||
    !isSafeReturnPath(decodedPayload.returnTo) ||
    !("userId" in decodedPayload) ||
    decodedPayload.userId !== expectedUserId
  ) {
    throw new Error("GitHub installation state payload is invalid.");
  }

  if (decodedPayload.expiresAt < Math.floor(now.getTime() / 1_000)) {
    throw new Error("GitHub installation state has expired.");
  }

  return decodedPayload as InstallationStatePayload;
};
