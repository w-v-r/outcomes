import "server-only";

import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const API_KEY_PATTERN =
  /^outcomes_test_([a-f0-9]{12})_([A-Za-z0-9_-]{32,80})$/u;

export type GeneratedApiKey = {
  hashHex: string;
  lastFour: string;
  lookupPrefix: string;
  value: string;
};

export const hashApiKey = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

export const parseApiKey = (value: string) => {
  const match = value.match(API_KEY_PATTERN);

  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    lookupPrefix: match[1],
    secret: match[2],
  };
};

export const generateApiKey = (): GeneratedApiKey => {
  const lookupPrefix = randomBytes(6).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const value = `outcomes_test_${lookupPrefix}_${secret}`;

  return {
    hashHex: hashApiKey(value),
    lastFour: secret.slice(-4),
    lookupPrefix,
    value,
  };
};

export const apiKeyHashesMatch = (
  candidateHashHex: string,
  storedHashHex: string,
) => {
  if (
    !/^[0-9a-f]{64}$/u.test(candidateHashHex) ||
    !/^[0-9a-f]{64}$/u.test(storedHashHex)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(candidateHashHex, "hex"),
    Buffer.from(storedHashHex, "hex"),
  );
};

export const getBearerToken = (authorizationHeader: string | null) => {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/iu);
  return match?.[1]?.trim() || null;
};
