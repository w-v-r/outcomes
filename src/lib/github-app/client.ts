import { createGitHubAppJwt } from "@/lib/github-app/auth";
import { type GitHubAppConfig } from "@/lib/github-app/config";
import {
  parseGitHubRepository,
  type GitHubRepository,
} from "@/lib/repositories/github";

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_VERSION = "2026-03-10";

type FetchImplementation = typeof fetch;

export class GitHubAppRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubAppRequestError";
    this.status = status;
  }
}

const readJson = async <Result>(
  response: Response,
  operation: string,
): Promise<Result> => {
  if (!response.ok) {
    throw new GitHubAppRequestError(
      `GitHub ${operation} failed with status ${response.status}.`,
      response.status,
    );
  }

  return (await response.json()) as Result;
};

const githubHeaders = (token: string): HeadersInit => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": GITHUB_API_VERSION,
});

export type GitHubInstallation = {
  accountId: number;
  accountLogin: string;
  accountType: string;
  appId: number;
  appSlug: string;
  installationId: number;
  permissions: Record<string, string>;
  repositorySelection: "all" | "selected";
  suspendedAt: string | null;
};

export type GitHubInstallationToken = {
  expiresAt: string;
  token: string;
};

type UserInstallationResponse = {
  account: {
    id: number;
    login?: string;
    slug?: string;
    type?: string;
  };
  app_id: number;
  app_slug: string;
  id: number;
  permissions: Record<string, string>;
  repository_selection: "all" | "selected";
  suspended_at: string | null;
};

const toInstallation = (
  installation: UserInstallationResponse,
): GitHubInstallation => ({
  accountId: installation.account.id,
  accountLogin:
    installation.account.login ?? installation.account.slug ?? "unknown",
  accountType: installation.account.type ?? "Enterprise",
  appId: installation.app_id,
  appSlug: installation.app_slug,
  installationId: installation.id,
  permissions: installation.permissions,
  repositorySelection: installation.repository_selection,
  suspendedAt: installation.suspended_at,
});

export class GitHubAppClient {
  readonly #config: GitHubAppConfig;
  readonly #fetch: FetchImplementation;
  readonly #now: () => Date;

  constructor({
    config,
    fetchImplementation = fetch,
    now = () => new Date(),
  }: {
    config: GitHubAppConfig;
    fetchImplementation?: FetchImplementation;
    now?: () => Date;
  }) {
    this.#config = config;
    this.#fetch = fetchImplementation;
    this.#now = now;
  }

  createInstallUrl(state: string): string {
    const url = new URL(
      `https://github.com/apps/${this.#config.slug}/installations/new`,
    );
    url.searchParams.set("state", state);
    return url.toString();
  }

  async verifyUserInstallation({
    code,
    installationId,
  }: {
    code: string;
    installationId: number;
  }): Promise<GitHubInstallation> {
    const tokenResponse = await this.#fetch(GITHUB_OAUTH_TOKEN_URL, {
      body: JSON.stringify({
        client_id: this.#config.clientId,
        client_secret: this.#config.clientSecret,
        code,
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const tokenPayload = await readJson<{
      access_token?: string;
      error?: string;
    }>(tokenResponse, "OAuth token exchange");

    if (!tokenPayload.access_token || tokenPayload.error) {
      throw new GitHubAppRequestError(
        "GitHub OAuth token exchange did not return an access token.",
        401,
      );
    }

    const installationsResponse = await this.#fetch(
      `${GITHUB_API_URL}/user/installations?per_page=100`,
      {
        headers: githubHeaders(tokenPayload.access_token),
      },
    );
    const installationsPayload = await readJson<{
      installations: UserInstallationResponse[];
    }>(installationsResponse, "user installation verification");
    const installation = installationsPayload.installations.find(
      ({ app_id: appId, app_slug: appSlug, id }) =>
        id === installationId &&
        appId === this.#config.appId &&
        appSlug.toLowerCase() === this.#config.slug,
    );

    if (!installation) {
      throw new GitHubAppRequestError(
        "The GitHub App installation is not accessible to the authorizing user.",
        403,
      );
    }

    return toInstallation(installation);
  }

  async createInstallationToken({
    installationId,
    purpose,
    repository,
    repositoryId,
  }: {
    installationId: number;
    purpose: "clone" | "discover" | "publish" | "scan" | "verify";
    repository: GitHubRepository;
    repositoryId?: number;
  }): Promise<GitHubInstallationToken> {
    if (
      purpose !== "discover" &&
      (!repositoryId ||
        !Number.isSafeInteger(repositoryId) ||
        repositoryId <= 0)
    ) {
      throw new Error(
        "A verified GitHub repository ID is required for clone, scan, publication, and verification.",
      );
    }

    const jwt = createGitHubAppJwt({
      appId: this.#config.appId,
      now: this.#now(),
      privateKey: this.#config.privateKey,
    });
    const response = await this.#fetch(
      `${GITHUB_API_URL}/app/installations/${installationId}/access_tokens`,
      {
        body: JSON.stringify({
          permissions:
            purpose === "publish"
              ? {
                  contents: "write",
                  pull_requests: "write",
                }
              : purpose === "verify"
                ? {
                    actions: "write",
                    contents: "read",
                  }
              : { contents: "read" },
          ...(repositoryId
            ? { repository_ids: [repositoryId] }
            : { repositories: [repository.name] }),
        }),
        headers: githubHeaders(jwt),
        method: "POST",
      },
    );
    const payload = await readJson<{
      expires_at: string;
      repositories?: Array<{ full_name: string; id: number }>;
      token: string;
    }>(response, "installation token creation");
    const tokenRepository = payload.repositories?.find(
      ({ full_name: fullName, id }) =>
        fullName.toLowerCase() === repository.fullName &&
        (repositoryId === undefined || id === repositoryId),
    );

    if (payload.repositories && !tokenRepository) {
      throw new GitHubAppRequestError(
        "The installation token is not scoped to the requested repository.",
        403,
      );
    }

    return {
      expiresAt: payload.expires_at,
      token: payload.token,
    };
  }

  async getInstallation(
    installationId: number,
  ): Promise<GitHubInstallation> {
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      throw new Error("A positive GitHub installation ID is required.");
    }

    const jwt = createGitHubAppJwt({
      appId: this.#config.appId,
      now: this.#now(),
      privateKey: this.#config.privateKey,
    });
    const response = await this.#fetch(
      `${GITHUB_API_URL}/app/installations/${installationId}`,
      {
        headers: githubHeaders(jwt),
      },
    );
    const installation = await readJson<UserInstallationResponse>(
      response,
      "installation lookup",
    );

    if (
      installation.id !== installationId ||
      installation.app_id !== this.#config.appId ||
      installation.app_slug.toLowerCase() !== this.#config.slug
    ) {
      throw new GitHubAppRequestError(
        "GitHub returned an unexpected App installation.",
        403,
      );
    }

    return toInstallation(installation);
  }
}

export class GitHubInstallationClient {
  readonly #fetch: FetchImplementation;
  readonly #token: string;

  constructor({
    fetchImplementation = fetch,
    token,
  }: {
    fetchImplementation?: FetchImplementation;
    token: string;
  }) {
    this.#fetch = fetchImplementation;
    this.#token = token;
  }

  async request<Result>(
    path: string,
    init: RequestInit = {},
  ): Promise<Result> {
    const response = await this.#fetch(`${GITHUB_API_URL}${path}`, {
      ...init,
      headers: {
        ...githubHeaders(this.#token),
        ...init.headers,
      },
    });

    return readJson<Result>(response, "installation API request");
  }

  async requestOrNull<Result>(
    path: string,
    init: RequestInit = {},
  ): Promise<Result | null> {
    try {
      return await this.request<Result>(path, init);
    } catch (error) {
      if (
        error instanceof GitHubAppRequestError &&
        error.status === 404
      ) {
        return null;
      }

      throw error;
    }
  }

  async requestWithoutResponse(
    path: string,
    init: RequestInit = {},
  ): Promise<void> {
    const response = await this.#fetch(`${GITHUB_API_URL}${path}`, {
      ...init,
      headers: {
        ...githubHeaders(this.#token),
        ...init.headers,
      },
    });

    if (!response.ok) {
      throw new GitHubAppRequestError(
        `GitHub installation API request failed with status ${response.status}.`,
        response.status,
      );
    }
  }

  async revokeToken(): Promise<void> {
    await this.requestWithoutResponse("/installation/token", {
      method: "DELETE",
    });
  }
}

export const requireGitHubRepository = (
  repositoryUrl: string,
): GitHubRepository => {
  const repository = parseGitHubRepository(repositoryUrl);

  if (!repository) {
    throw new Error("A valid GitHub repository URL is required.");
  }

  return repository;
};
