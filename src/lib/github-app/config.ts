import { readFileSync } from "node:fs";
import path from "node:path";

const requireEnvironmentValue = (name: string): string => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
};

const requirePositiveInteger = (name: string): number => {
  const value = requireEnvironmentValue(name);
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsedValue;
};

const normalizePrivateKey = (value: string): string =>
  value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;

const requirePrivateKey = (): string => {
  const inlinePrivateKey =
    process.env.OUTCOMES_GITHUB_APP_PRIVATE_KEY?.trim();

  if (inlinePrivateKey) {
    return normalizePrivateKey(inlinePrivateKey);
  }

  const privateKeyPath =
    process.env.OUTCOMES_GITHUB_APP_PRIVATE_KEY_PATH?.trim();

  if (!privateKeyPath) {
    throw new Error(
      "OUTCOMES_GITHUB_APP_PRIVATE_KEY or OUTCOMES_GITHUB_APP_PRIVATE_KEY_PATH is not configured.",
    );
  }

  return readFileSync(path.resolve(privateKeyPath), "utf8").trim();
};

export type GitHubAppConfig = {
  appId: number;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  slug: string;
  stateSecret: string;
};

export const getGitHubAppConfig = (): GitHubAppConfig => ({
  appId: requirePositiveInteger("OUTCOMES_GITHUB_APP_ID"),
  clientId: requireEnvironmentValue("OUTCOMES_GITHUB_APP_CLIENT_ID"),
  clientSecret: requireEnvironmentValue("OUTCOMES_GITHUB_APP_CLIENT_SECRET"),
  privateKey: requirePrivateKey(),
  slug: requireEnvironmentValue("OUTCOMES_GITHUB_APP_SLUG").toLowerCase(),
  stateSecret: requireEnvironmentValue("OUTCOMES_GITHUB_APP_STATE_SECRET"),
});
