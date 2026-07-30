import {
  AuthenticationError,
  Cursor,
  CursorSdkError,
  IntegrationNotConnectedError,
  type SDKRepository,
  type SDKUser,
} from "@cursor/sdk";

import { normalizeGitHubRepositoryUrl } from "@/lib/repositories/github";

export type CursorIdentity = {
  apiKeyName: string;
  identityType: "service_account" | "user";
};

export type CursorRepositoryAccessResult = {
  connectedRepositoryCount: number;
  identity: CursorIdentity | null;
  normalizedRepositoryUrl: string | null;
  retryable: boolean;
  status:
    | "connected"
    | "not_connected"
    | "invalid_repository"
    | "integration_not_connected"
    | "authentication_failed"
    | "catalog_unavailable";
};

type CursorRepositoryCatalog = {
  getIdentity: (apiKey: string) => Promise<SDKUser>;
  listRepositories: (apiKey: string) => Promise<SDKRepository[]>;
};

const cursorRepositoryCatalog: CursorRepositoryCatalog = {
  getIdentity: (apiKey) => Cursor.me({ apiKey }),
  listRepositories: (apiKey) =>
    Cursor.repositories.list({ apiKey }),
};

const toIdentity = (user: SDKUser): CursorIdentity => ({
  apiKeyName: user.apiKeyName,
  identityType:
    user.userId === undefined ? "service_account" : "user",
});

export const inspectCursorRepositoryAccess = async (
  {
    apiKey,
    repositoryUrl,
  }: {
    apiKey: string;
    repositoryUrl: string;
  },
  catalog: CursorRepositoryCatalog = cursorRepositoryCatalog,
): Promise<CursorRepositoryAccessResult> => {
  const normalizedRepositoryUrl =
    normalizeGitHubRepositoryUrl(repositoryUrl);

  if (!normalizedRepositoryUrl) {
    return {
      connectedRepositoryCount: 0,
      identity: null,
      normalizedRepositoryUrl: null,
      retryable: false,
      status: "invalid_repository",
    };
  }

  try {
    const [user, repositories] = await Promise.all([
      catalog.getIdentity(apiKey),
      catalog.listRepositories(apiKey),
    ]);
    const normalizedConnectedRepositories = new Set(
      repositories
        .map(({ url }) => normalizeGitHubRepositoryUrl(url))
        .filter((url): url is string => url !== null),
    );

    return {
      connectedRepositoryCount: normalizedConnectedRepositories.size,
      identity: toIdentity(user),
      normalizedRepositoryUrl,
      retryable: false,
      status: normalizedConnectedRepositories.has(
        normalizedRepositoryUrl,
      )
        ? "connected"
        : "not_connected",
    };
  } catch (error) {
    if (error instanceof IntegrationNotConnectedError) {
      return {
        connectedRepositoryCount: 0,
        identity: null,
        normalizedRepositoryUrl,
        retryable: false,
        status: "integration_not_connected",
      };
    }

    if (error instanceof AuthenticationError) {
      return {
        connectedRepositoryCount: 0,
        identity: null,
        normalizedRepositoryUrl,
        retryable: false,
        status: "authentication_failed",
      };
    }

    if (error instanceof CursorSdkError) {
      return {
        connectedRepositoryCount: 0,
        identity: null,
        normalizedRepositoryUrl,
        retryable: error.isRetryable,
        status: "catalog_unavailable",
      };
    }

    throw error;
  }
};
