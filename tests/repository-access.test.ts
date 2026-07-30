import {
  AuthenticationError,
  IntegrationNotConnectedError,
} from "@cursor/sdk";
import { describe, expect, test } from "vitest";

import { inspectCursorRepositoryAccess } from "@/lib/workers/cursor/repository-access";

const USER_IDENTITY = {
  apiKeyName: "test-user-key",
  createdAt: "2026-07-30T00:00:00.000Z",
  userId: 42,
};

describe("Cursor repository access preflight", () => {
  test("rejects invalid GitHub repository URLs without querying Cursor", async () => {
    let catalogWasCalled = false;
    const result = await inspectCursorRepositoryAccess(
      {
        apiKey: "cursor_test",
        repositoryUrl: "https://example.com/acme/repository",
      },
      {
        getIdentity: async () => {
          catalogWasCalled = true;
          return USER_IDENTITY;
        },
        listRepositories: async () => {
          catalogWasCalled = true;
          return [];
        },
      },
    );

    expect(result).toMatchObject({
      identity: null,
      normalizedRepositoryUrl: null,
      status: "invalid_repository",
    });
    expect(catalogWasCalled).toBe(false);
  });

  test("matches normalized connected repositories and reports identity type", async () => {
    const result = await inspectCursorRepositoryAccess(
      {
        apiKey: "cursor_test",
        repositoryUrl: "git@github.com:Acme/Repository.git",
      },
      {
        getIdentity: async () => USER_IDENTITY,
        listRepositories: async () => [
          { url: "https://github.com/acme/repository" },
          { url: "git@github.com:ACME/REPOSITORY.git" },
          { url: "https://example.com/not-github/repository" },
        ],
      },
    );

    expect(result).toEqual({
      connectedRepositoryCount: 1,
      identity: {
        apiKeyName: "test-user-key",
        identityType: "user",
      },
      normalizedRepositoryUrl:
        "https://github.com/acme/repository",
      retryable: false,
      status: "connected",
    });
  });

  test("distinguishes an unconnected repository from a missing integration", async () => {
    const notConnectedResult = await inspectCursorRepositoryAccess(
      {
        apiKey: "cursor_test",
        repositoryUrl: "https://github.com/other/repository",
      },
      {
        getIdentity: async () => ({
          apiKeyName: "service-key",
          createdAt: "2026-07-30T00:00:00.000Z",
        }),
        listRepositories: async () => [
          { url: "https://github.com/acme/repository" },
        ],
      },
    );
    const integrationMissingResult =
      await inspectCursorRepositoryAccess(
        {
          apiKey: "cursor_test",
          repositoryUrl: "https://github.com/other/repository",
        },
        {
          getIdentity: async () => USER_IDENTITY,
          listRepositories: async () => {
            throw new IntegrationNotConnectedError(
              "Connect GitHub before selecting a repository.",
              {
                helpUrl: "https://cursor.com/dashboard/integrations",
                provider: "github",
              },
            );
          },
        },
      );

    expect(notConnectedResult).toMatchObject({
      identity: {
        apiKeyName: "service-key",
        identityType: "service_account",
      },
      status: "not_connected",
    });
    expect(integrationMissingResult).toMatchObject({
      identity: null,
      status: "integration_not_connected",
    });
  });

  test("returns a stable authentication failure without exposing credentials", async () => {
    const result = await inspectCursorRepositoryAccess(
      {
        apiKey: "cursor_secret_value",
        repositoryUrl: "https://github.com/acme/repository",
      },
      {
        getIdentity: async () => {
          throw new AuthenticationError("Invalid API key.");
        },
        listRepositories: async () => [],
      },
    );

    expect(JSON.stringify(result)).not.toContain("cursor_secret_value");
    expect(result).toMatchObject({
      retryable: false,
      status: "authentication_failed",
    });
  });
});
