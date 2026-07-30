const API_KEY_PATTERN =
  /^outcomes_test_([a-f0-9]{12})_([A-Za-z0-9_-]{32,80})$/u;

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

export const getBearerToken = (authorizationHeader: string | null) => {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/iu);
  return match?.[1]?.trim() || null;
};

export const maskApiKey = (value: string) => {
  const parsed = parseApiKey(value);

  if (!parsed) {
    return "(invalid key format)";
  }

  return `outcomes_test_${parsed.lookupPrefix}_…${parsed.secret.slice(-4)}`;
};
