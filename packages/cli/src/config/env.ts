import {
  OUTCOMES_API_DEFAULT_BASE_URL,
  parseApiKey,
} from "@outcomes/contracts";
import { assertAllowedBaseUrl } from "@outcomes/client";

export type CliEnvironment = {
  apiKey: string;
  baseUrl: string;
};

export const loadEnvironment = (): CliEnvironment => {
  const apiKey = process.env.OUTCOMES_API_KEY?.trim() ?? "";
  const baseUrl = assertAllowedBaseUrl(
    process.env.OUTCOMES_API_BASE_URL?.trim() ||
      OUTCOMES_API_DEFAULT_BASE_URL,
  );

  return { apiKey, baseUrl };
};

export const validateApiKeyFormat = (apiKey: string): boolean =>
  parseApiKey(apiKey) !== null;

export const requireApiKey = (environment: CliEnvironment): string => {
  if (!environment.apiKey) {
    throw new Error(
      "Set OUTCOMES_API_KEY to an Outcomes dashboard API key before continuing.",
    );
  }

  if (!validateApiKeyFormat(environment.apiKey)) {
    throw new Error(
      "OUTCOMES_API_KEY must match outcomes_test_<prefix>_<secret>.",
    );
  }

  return environment.apiKey;
};
