import { maskApiKey } from "@outcomes/contracts";
import { OutcomesClientError } from "@outcomes/client";

import type { CliContext } from "../context.js";
import { mapClientErrorToExit, CLI_EXIT } from "../exit-mapping.js";
import { logInfo, writeJson } from "../output/format.js";
import { validateApiKeyFormat } from "../config/env.js";

export const runAuthStatus = async (
  context: CliContext,
  signal?: AbortSignal,
): Promise<number> => {
  const { apiKey, baseUrl } = context.environment;

  if (!apiKey) {
    logInfo("OUTCOMES_API_KEY is not set.");
    return CLI_EXIT.auth;
  }

  if (!validateApiKeyFormat(apiKey)) {
    logInfo("OUTCOMES_API_KEY format is invalid.");
    return CLI_EXIT.auth;
  }

  try {
    const result = await context.client.verifyAuth(signal);
    const payload = {
      api_key: maskApiKey(apiKey),
      base_url: baseUrl,
      installations: result.installations.length,
      status: "authenticated" as const,
    };

    if (context.outputMode === "json") {
      writeJson(payload);
      return CLI_EXIT.success;
    }

    logInfo(`Outcomes API: ${baseUrl}`);
    logInfo(`API key: ${payload.api_key}`);
    logInfo(
      `Authenticated. Active GitHub App generations: ${payload.installations}.`,
    );

    return CLI_EXIT.success;
  } catch (error) {
    if (error instanceof OutcomesClientError) {
      if (context.outputMode === "json") {
        writeJson({
          api_key: maskApiKey(apiKey),
          base_url: baseUrl,
          error: {
            code: error.apiCode ?? error.code,
            message: error.message,
          },
          status: "unauthenticated",
        });
      } else {
        logInfo(error.message);
      }

      return mapClientErrorToExit(error);
    }

    return CLI_EXIT.internal;
  }
};
