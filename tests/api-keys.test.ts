import { describe, expect, test } from "vitest";

import {
  apiKeyHashesMatch,
  generateApiKey,
  getBearerToken,
  hashApiKey,
  parseApiKey,
} from "@/lib/api-keys/core";

describe("Outcomes API keys", () => {
  test("generates parseable keys and stores only a hash", () => {
    const generatedKey = generateApiKey();
    const parsedKey = parseApiKey(generatedKey.value);

    expect(parsedKey?.lookupPrefix).toBe(generatedKey.lookupPrefix);
    expect(generatedKey.value).not.toContain(generatedKey.hashHex);
    expect(generatedKey.hashHex).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      apiKeyHashesMatch(
        hashApiKey(generatedKey.value),
        generatedKey.hashHex,
      ),
    ).toBe(true);
  });

  test("rejects malformed keys and unequal hashes", () => {
    const generatedKey = generateApiKey();

    expect(parseApiKey("not-a-key")).toBeNull();
    expect(
      apiKeyHashesMatch(
        hashApiKey(`${generatedKey.value}changed`),
        generatedKey.hashHex,
      ),
    ).toBe(false);
    expect(apiKeyHashesMatch("bad", generatedKey.hashHex)).toBe(false);
  });

  test("requires an explicit Bearer scheme", () => {
    const generatedKey = generateApiKey();

    expect(
      getBearerToken(`Bearer ${generatedKey.value}`),
    ).toBe(generatedKey.value);
    expect(getBearerToken(generatedKey.value)).toBeNull();
    expect(getBearerToken(null)).toBeNull();
  });
});
