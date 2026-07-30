import { execFile } from "node:child_process";
import {
  generateKeyPairSync,
  verify,
} from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createGitHubAppJwt,
  createGitHubInstallationState,
  verifyGitHubInstallationState,
} from "@/lib/github-app/auth";
import {
  GitHubAppClient,
  GitHubInstallationClient,
  requireGitHubRepository,
} from "@/lib/github-app/client";
import {
  createPublicationBranch,
  publishGitHubPullRequest,
} from "@/lib/github-app/publisher";
import { createIsolatedWorkerEnvironment } from "@/lib/workers/isolated/process";
import { collectValidatedWorkspaceChanges } from "@/lib/workers/isolated/workspace-changes";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("GitHub App authentication", () => {
  test("creates a short-lived RS256 app JWT", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2_048,
    });
    const now = new Date("2026-07-30T12:00:00.000Z");
    const token = createGitHubAppJwt({
      appId: 123_456,
      now,
      privateKey: privateKey.export({
        format: "pem",
        type: "pkcs8",
      }).toString(),
    });
    const [header, payload, signature] = token.split(".");

    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toEqual({
      exp: Math.floor(now.getTime() / 1_000) + 540,
      iat: Math.floor(now.getTime() / 1_000) - 60,
      iss: 123_456,
    });
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });

  test("binds installation state to one user and expiry", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const state = createGitHubInstallationState({
      now,
      returnTo: "/dashboard",
      secret: "test-state-secret-with-enough-entropy",
      userId: "user-123",
    });

    expect(
      verifyGitHubInstallationState({
        expectedUserId: "user-123",
        now,
        secret: "test-state-secret-with-enough-entropy",
        state,
      }),
    ).toMatchObject({
      returnTo: "/dashboard",
      userId: "user-123",
    });
    expect(() =>
      verifyGitHubInstallationState({
        expectedUserId: "other-user",
        now,
        secret: "test-state-secret-with-enough-entropy",
        state,
      }),
    ).toThrow("payload is invalid");
    expect(() =>
      verifyGitHubInstallationState({
        expectedUserId: "user-123",
        now: new Date("2026-07-30T12:11:00.000Z"),
        secret: "test-state-secret-with-enough-entropy",
        state,
      }),
    ).toThrow("expired");
  });
});

describe("GitHub App client", () => {
  test("verifies the installation against the authorizing GitHub user", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: "github_user_token" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          installations: [
            {
              account: {
                id: 55,
                login: "Acme",
                type: "Organization",
              },
              app_id: 123,
              app_slug: "outcomes-test",
              id: 987,
              permissions: {
                contents: "write",
                pull_requests: "write",
              },
              repository_selection: "selected",
              suspended_at: null,
            },
          ],
        }),
      );
    const client = new GitHubAppClient({
      config: {
        appId: 123,
        clientId: "client-id",
        clientSecret: "client-secret",
        privateKey: "unused",
        slug: "outcomes-test",
        stateSecret: "state-secret",
      },
      fetchImplementation,
    });

    await expect(
      client.verifyUserInstallation({
        code: "one-time-code",
        installationId: 987,
      }),
    ).resolves.toEqual({
      accountId: 55,
      accountLogin: "Acme",
      accountType: "Organization",
      appId: 123,
      appSlug: "outcomes-test",
      installationId: 987,
      permissions: {
        contents: "write",
        pull_requests: "write",
      },
      repositorySelection: "selected",
      suspendedAt: null,
    });

    expect(fetchImplementation.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer github_user_token",
    });
  });

  test("narrows clone and publication tokens to one repository and phase", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2_048,
    });
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({
          expires_at: "2026-07-30T13:00:00.000Z",
          repositories: [
            { full_name: "acme/private-repo", id: 77 },
          ],
          token: "installation-token",
        }),
      );
    const client = new GitHubAppClient({
      config: {
        appId: 123,
        clientId: "client-id",
        clientSecret: "client-secret",
        privateKey: privateKey.export({
          format: "pem",
          type: "pkcs8",
        }).toString(),
        slug: "outcomes-test",
        stateSecret: "state-secret",
      },
      fetchImplementation,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
    });
    const repository = requireGitHubRepository(
      "https://github.com/acme/private-repo",
    );

    await client.createInstallationToken({
      installationId: 987,
      purpose: "discover",
      repository,
    });
    await client.createInstallationToken({
      installationId: 987,
      purpose: "clone",
      repository,
      repositoryId: 77,
    });
    await client.createInstallationToken({
      installationId: 987,
      purpose: "publish",
      repository,
      repositoryId: 77,
    });

    expect(
      JSON.parse(
        fetchImplementation.mock.calls[0]?.[1]?.body as string,
      ),
    ).toEqual({
      permissions: { contents: "read" },
      repositories: ["private-repo"],
    });
    expect(
      JSON.parse(
        fetchImplementation.mock.calls[1]?.[1]?.body as string,
      ),
    ).toEqual({
      permissions: { contents: "read" },
      repository_ids: [77],
    });
    expect(
      JSON.parse(
        fetchImplementation.mock.calls[2]?.[1]?.body as string,
      ),
    ).toEqual({
      permissions: {
        contents: "write",
        pull_requests: "write",
      },
      repository_ids: [77],
    });
  });
});

describe("isolated workspace validation", () => {
  test("constructs a minimal worker environment without ambient credentials", () => {
    const environment = createIsolatedWorkerEnvironment({
      nodeEnvironment: "test",
      pathValue: "/usr/bin:/bin",
      rootDirectory: "/tmp/outcomes-worker",
      workerHome: "/tmp/outcomes-worker/home",
    });

    expect(environment).toEqual({
      HOME: "/tmp/outcomes-worker/home",
      LANG: "C.UTF-8",
      NODE_ENV: "test",
      PATH: "/usr/bin:/bin",
      TERM: "dumb",
      TMPDIR: "/tmp/outcomes-worker",
    });
    expect(environment).not.toHaveProperty("CURSOR_API_KEY");
    expect(environment).not.toHaveProperty(
      "OUTCOMES_GITHUB_INSTALLATION_TOKEN",
    );
    expect(environment).not.toHaveProperty(
      "OUTCOMES_GITHUB_APP_PRIVATE_KEY",
    );
  });

  test("rejects workflow and dependency publication scopes before execution", async () => {
    await expect(
      collectValidatedWorkspaceChanges({
        allowedPaths: [".github/workflows/"],
        baseSha: "a".repeat(40),
        gitDirectory: "/unused",
        workspaceDirectory: "/unused",
      }),
    ).rejects.toThrow("safe allowed path");
    await expect(
      collectValidatedWorkspaceChanges({
        allowedPaths: ["package.json"],
        baseSha: "a".repeat(40),
        gitDirectory: "/unused",
        workspaceDirectory: "/unused",
      }),
    ).rejects.toThrow("safe allowed path");
  });

  test("rejects repositories containing baseline symlinks", async () => {
    const rootDirectory = await mkdtemp(
      path.join(os.tmpdir(), "outcomes-symlink-test-"),
    );
    temporaryDirectories.push(rootDirectory);
    const workspaceDirectory = path.join(rootDirectory, "workspace");
    const gitDirectory = path.join(rootDirectory, "git-metadata");
    await mkdir(workspaceDirectory);
    await execFileAsync("git", ["init", "--quiet"], {
      cwd: workspaceDirectory,
    });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: workspaceDirectory,
    });
    await execFileAsync("git", ["config", "user.name", "Outcomes Test"], {
      cwd: workspaceDirectory,
    });
    await writeFile(path.join(workspaceDirectory, "target.txt"), "target\n");
    await symlink("target.txt", path.join(workspaceDirectory, "link.txt"));
    await execFileAsync("git", ["add", "target.txt", "link.txt"], {
      cwd: workspaceDirectory,
    });
    await execFileAsync("git", ["commit", "--quiet", "-m", "baseline"], {
      cwd: workspaceDirectory,
    });
    const { stdout: baseShaOutput } = await execFileAsync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: workspaceDirectory },
    );
    await rename(path.join(workspaceDirectory, ".git"), gitDirectory);

    await expect(
      collectValidatedWorkspaceChanges({
        allowedPaths: ["target.txt"],
        baseSha: baseShaOutput.trim(),
        gitDirectory,
        workspaceDirectory,
      }),
    ).rejects.toThrow("symlinks or submodules");
  });

  test("collects only allowlisted regular text changes from an external Git directory", async () => {
    const rootDirectory = await mkdtemp(
      path.join(os.tmpdir(), "outcomes-change-test-"),
    );
    temporaryDirectories.push(rootDirectory);
    const workspaceDirectory = path.join(rootDirectory, "workspace");
    const gitDirectory = path.join(rootDirectory, "git-metadata");
    await mkdir(workspaceDirectory);
    await execFileAsync("git", ["init", "--quiet"], {
      cwd: workspaceDirectory,
    });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: workspaceDirectory,
    });
    await execFileAsync("git", ["config", "user.name", "Outcomes Test"], {
      cwd: workspaceDirectory,
    });
    await writeFile(
      path.join(workspaceDirectory, "README.md"),
      "before\n",
    );
    await execFileAsync("git", ["add", "README.md"], {
      cwd: workspaceDirectory,
    });
    await execFileAsync("git", ["commit", "--quiet", "-m", "baseline"], {
      cwd: workspaceDirectory,
    });
    const { stdout: baseShaOutput } = await execFileAsync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: workspaceDirectory },
    );
    const baseSha = baseShaOutput.trim();
    await rename(path.join(workspaceDirectory, ".git"), gitDirectory);
    await writeFile(
      path.join(workspaceDirectory, "README.md"),
      "after\n",
    );

    await expect(
      collectValidatedWorkspaceChanges({
        allowedPaths: ["README.md"],
        baseSha,
        gitDirectory,
        workspaceDirectory,
      }),
    ).resolves.toEqual([
      {
        contentBase64: Buffer.from("after\n").toString("base64"),
        mode: "100644",
        path: "README.md",
        status: "modified",
      },
    ]);
  });

  test("rejects a change outside the explicit publication scope", async () => {
    const rootDirectory = await mkdtemp(
      path.join(os.tmpdir(), "outcomes-change-test-"),
    );
    temporaryDirectories.push(rootDirectory);
    const workspaceDirectory = path.join(rootDirectory, "workspace");
    const gitDirectory = path.join(rootDirectory, "git-metadata");
    await mkdir(workspaceDirectory);
    await execFileAsync("git", ["init", "--quiet"], {
      cwd: workspaceDirectory,
    });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: workspaceDirectory,
    });
    await execFileAsync("git", ["config", "user.name", "Outcomes Test"], {
      cwd: workspaceDirectory,
    });
    await writeFile(path.join(workspaceDirectory, "package.json"), "{}\n");
    await execFileAsync("git", ["add", "package.json"], {
      cwd: workspaceDirectory,
    });
    await execFileAsync("git", ["commit", "--quiet", "-m", "baseline"], {
      cwd: workspaceDirectory,
    });
    const { stdout: baseShaOutput } = await execFileAsync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: workspaceDirectory },
    );
    await rename(path.join(workspaceDirectory, ".git"), gitDirectory);
    await writeFile(path.join(workspaceDirectory, "package.json"), '{"x":1}\n');

    await expect(
      collectValidatedWorkspaceChanges({
        allowedPaths: ["src/"],
        baseSha: baseShaOutput.trim(),
        gitDirectory,
        workspaceDirectory,
      }),
    ).rejects.toThrow("prohibited path");
  });
});

describe("deterministic publication identity", () => {
  test.each([
    "http://github.com/acme/private-repo",
    "https://token@github.com/acme/private-repo",
    "https://github.com:443/acme/private-repo",
    "https://github.com/acme/private-repo/issues",
    "https://github.com/acme/private-repo?tab=readme",
    "https://github.com/acme/private-repo#readme",
  ])("rejects non-canonical or credential-bearing repository URL %s", (url) => {
    expect(() => requireGitHubRepository(url)).toThrow(
      "valid GitHub repository URL",
    );
  });

  test("normalizes repository identity and hashes the exact change set", () => {
    const repository = requireGitHubRepository(
      "git@github.com:Acme/Private-Repo.git",
    );
    const input = {
      baseSha: "a".repeat(40),
      changes: [
        {
          contentBase64: Buffer.from("hello\n").toString("base64"),
          mode: "100644" as const,
          path: "README.md",
          status: "modified" as const,
        },
      ],
      taskIdentity: "task-123",
    };

    expect(repository).toMatchObject({
      fullName: "acme/private-repo",
      url: "https://github.com/acme/private-repo",
    });
    expect(createPublicationBranch(input)).toBe(
      createPublicationBranch(input),
    );
    expect(createPublicationBranch(input)).toMatch(
      /^outcomes\/spike-[0-9a-f]{12}$/u,
    );
  });

  test("publishes only when the base and changed-file evidence match", async () => {
    const baseSha = "a".repeat(40);
    const commitSha = "b".repeat(40);
    const responses = [
      { body: { object: { sha: baseSha, type: "commit" } }, status: 200 },
      {
        body: {
          committer: { date: "2026-07-30T00:00:00.000Z" },
          sha: baseSha,
          tree: { sha: "base-tree" },
        },
        status: 200,
      },
      { body: { sha: "blob-sha" }, status: 200 },
      {
        body: { sha: "result-tree", truncated: false },
        status: 200,
      },
      {
        body: {
          committer: { login: "outcomes-test[bot]" },
          parents: [{ sha: baseSha }],
          sha: commitSha,
        },
        status: 200,
      },
      { body: { message: "Not Found" }, status: 404 },
      {
        body: { ref: "refs/heads/outcomes/spike-test" },
        status: 200,
      },
      { body: [], status: 200 },
      {
        body: {
          base: { ref: "main", sha: baseSha },
          head: { ref: "outcomes/spike-test", sha: commitSha },
          html_url: "https://github.com/acme/private-repo/pull/7",
          number: 7,
          state: "open",
          user: { login: "outcomes-test[bot]" },
        },
        status: 200,
      },
      { body: [{ filename: "README.md" }], status: 200 },
    ];
    const fetchImplementation = vi.fn<typeof fetch>(async () => {
      const response = responses.shift();
      return Response.json(response?.body ?? { message: "Unexpected" }, {
        status: response?.status ?? 500,
      });
    });
    const client = new GitHubInstallationClient({
      fetchImplementation,
      token: "installation-secret",
    });

    await expect(
      publishGitHubPullRequest({
        baseBranch: "main",
        baseSha,
        branch: "outcomes/spike-test",
        changes: [
          {
            contentBase64: Buffer.from("after\n").toString("base64"),
            mode: "100644",
            path: "README.md",
            status: "modified",
          },
        ],
        client,
        commitMessage: "Bounded change",
        pullRequestBody: "Evidence",
        pullRequestTitle: "Outcomes change",
        repository: requireGitHubRepository(
          "https://github.com/acme/private-repo",
        ),
      }),
    ).resolves.toEqual({
      baseBranch: "main",
      baseSha,
      branch: "outcomes/spike-test",
      changedFiles: ["README.md"],
      commitAuthor: "outcomes-test[bot]",
      commitSha,
      prAuthor: "outcomes-test[bot]",
      prNumber: 7,
      prUrl: "https://github.com/acme/private-repo/pull/7",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(10);
    expect(
      JSON.parse(
        fetchImplementation.mock.calls[4]?.[1]?.body as string,
      ),
    ).toMatchObject({
      author: { date: "2026-07-30T00:00:01.000Z" },
      committer: { date: "2026-07-30T00:00:01.000Z" },
      parents: [baseSha],
    });
    expect(
      JSON.parse(
        fetchImplementation.mock.calls[8]?.[1]?.body as string,
      ),
    ).toMatchObject({ draft: true });
    expect(
      fetchImplementation.mock.calls.every(
        ([, init]) =>
          (init?.headers as Record<string, string>).Authorization ===
          "Bearer installation-secret",
      ),
    ).toBe(true);
  });

  test("fails before publication if the protected base branch moved", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        object: { sha: "c".repeat(40), type: "commit" },
      }),
    );
    const client = new GitHubInstallationClient({
      fetchImplementation,
      token: "installation-secret",
    });

    await expect(
      publishGitHubPullRequest({
        baseBranch: "main",
        baseSha: "a".repeat(40),
        branch: "outcomes/spike-test",
        changes: [
          {
            contentBase64: Buffer.from("after\n").toString("base64"),
            mode: "100644",
            path: "README.md",
            status: "modified",
          },
        ],
        client,
        commitMessage: "Bounded change",
        pullRequestBody: "Evidence",
        pullRequestTitle: "Outcomes change",
        repository: requireGitHubRepository(
          "https://github.com/acme/private-repo",
        ),
      }),
    ).rejects.toThrow("base branch moved");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  test("reuses an exact deterministic branch and open pull request", async () => {
    const baseSha = "a".repeat(40);
    const commitSha = "b".repeat(40);
    const responses = [
      { object: { sha: baseSha, type: "commit" } },
      {
        committer: { date: "2026-07-30T00:00:00.000Z" },
        sha: baseSha,
        tree: { sha: "base-tree" },
      },
      { sha: "blob-sha" },
      { sha: "result-tree", truncated: false },
      {
        committer: null,
        parents: [{ sha: baseSha }],
        sha: commitSha,
      },
      { object: { sha: commitSha, type: "commit" } },
      [
        {
          base: { ref: "main", sha: baseSha },
          head: { ref: "outcomes/spike-test", sha: commitSha },
          html_url: "https://github.com/acme/private-repo/pull/7",
          number: 7,
          state: "open",
          user: { login: "outcomes-test[bot]" },
        },
      ],
      [{ filename: "README.md" }],
    ];
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json(responses.shift() ?? { message: "Unexpected" }),
    );
    const client = new GitHubInstallationClient({
      fetchImplementation,
      token: "installation-secret",
    });

    await expect(
      publishGitHubPullRequest({
        baseBranch: "main",
        baseSha,
        branch: "outcomes/spike-test",
        changes: [
          {
            contentBase64: Buffer.from("after\n").toString("base64"),
            mode: "100644",
            path: "README.md",
            status: "modified",
          },
        ],
        client,
        commitMessage: "Bounded change",
        pullRequestBody: "Evidence",
        pullRequestTitle: "Outcomes change",
        repository: requireGitHubRepository(
          "https://github.com/acme/private-repo",
        ),
      }),
    ).resolves.toMatchObject({
      commitSha,
      prNumber: 7,
    });
    expect(
      fetchImplementation.mock.calls.some(([url, init]) => {
        const requestUrl = String(url);
        return (
          init?.method === "POST" &&
          (requestUrl.endsWith("/git/refs") ||
            requestUrl.endsWith("/pulls"))
        );
      }),
    ).toBe(false);
  });
});
