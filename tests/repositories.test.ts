import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { create as createTarArchive } from "tar";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createReadOnlyGitHubArchiveWorkspace } from "@/lib/repositories/archive-workspace";
import {
  DeterministicRepositorySnapshotConflictError,
  createRepositoryCaptureService,
  resolveMatchingSnapshotId,
} from "@/lib/repositories/capture";
import {
  REPOSITORY_BINDING_SCHEMA_VERSION,
  REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
  assertRepositoryBindingMatchesSnapshot,
  calculateRepositoryManifestHash,
  githubBranchSchema,
  parseRepositorySnapshot,
  repositoryBindingSchema,
  repositorySnapshotSchema,
} from "@/lib/repositories/domain";
import { parseGitHubRepository } from "@/lib/repositories/github";
import { sha256CanonicalJson } from "@/lib/repositories/hash";
import {
  REPOSITORY_SCANNER_ID,
  REPOSITORY_SCANNER_VERSION,
  scanRepository,
} from "@/lib/repositories/scanner";

const COMMIT_SHA = "a".repeat(40);
const TREE_SHA = "b".repeat(40);
const USER_ID = "11111111-1111-4111-8111-111111111111";
const INSTALLATION_ROW_ID = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";
const BINDING_ID = "44444444-4444-4444-8444-444444444444";
const REPOSITORY_URL = "https://github.com/acme/example";
const temporaryDirectories: string[] = [];

const createRepositoryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "outcomes-repository-test-"),
  );
  temporaryDirectories.push(directory);
  return directory;
};

const scanFixture = async (rootPath: string, commitSha = COMMIT_SHA) =>
  scanRepository({
    expectedCommitSha: commitSha,
    rootPath,
    source: {
      kind: "github",
      ref: commitSha,
      url: REPOSITORY_URL,
    },
  });

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("repository contracts and hashing", () => {
  test("hashes manifests independent of object insertion order", async () => {
    const rootPath = await createRepositoryDirectory();
    await writeFile(path.join(rootPath, "index.ts"), "export const value = 1;\n");
    const manifest = await scanFixture(rootPath);
    const reorderedManifest = {
      totals: manifest.totals,
      testFiles: manifest.testFiles,
      source: {
        url: manifest.source.url,
        ref: manifest.source.ref,
        kind: manifest.source.kind,
      },
      snapshot: manifest.snapshot,
      schemaVersion: manifest.schemaVersion,
      packages: manifest.packages,
      oversizedFiles: manifest.oversizedFiles,
      manifests: manifest.manifests,
      languages: Object.fromEntries(
        Object.entries(manifest.languages).reverse(),
      ),
      files: manifest.files,
      baselineSignals: manifest.baselineSignals,
    };

    expect(sha256CanonicalJson(manifest)).toBe(
      sha256CanonicalJson(reorderedManifest),
    );
  });

  test("changes the hash when manifest content or commit SHA changes", async () => {
    const rootPath = await createRepositoryDirectory();
    await writeFile(path.join(rootPath, "index.ts"), "export const value = 1;\n");
    const firstManifest = await scanFixture(rootPath);
    const changedShaManifest = await scanFixture(rootPath, "c".repeat(40));
    await writeFile(
      path.join(rootPath, "index.ts"),
      "export const changedValue = 200;\n",
    );
    const changedContentManifest = await scanFixture(rootPath);

    expect(calculateRepositoryManifestHash(changedShaManifest)).not.toBe(
      calculateRepositoryManifestHash(firstManifest),
    );
    expect(calculateRepositoryManifestHash(changedContentManifest)).not.toBe(
      calculateRepositoryManifestHash(firstManifest),
    );
  });

  test("enforces strict schemas, hashes, and binding/snapshot identity", async () => {
    const rootPath = await createRepositoryDirectory();
    await writeFile(path.join(rootPath, "README.md"), "Example\n");
    const manifest = await scanFixture(rootPath);
    const snapshot = parseRepositorySnapshot({
      commitSha: COMMIT_SHA,
      manifest,
      manifestHash: calculateRepositoryManifestHash(manifest),
      repository: {
        canonicalUrl: REPOSITORY_URL,
        fullName: "acme/example",
        githubRepositoryId: 77,
        visibility: "private",
      },
      scanner: {
        id: REPOSITORY_SCANNER_ID,
        version: REPOSITORY_SCANNER_VERSION,
      },
      schemaVersion: REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
      treeSha: TREE_SHA,
    });
    const binding = repositoryBindingSchema.parse({
      accessBinding: {
        githubInstallationId: 987,
        provider: "github_app",
        storedInstallationId: INSTALLATION_ROW_ID,
      },
      baseBranch: "main",
      baseSha: COMMIT_SHA,
      manifestHash: snapshot.manifestHash,
      provider: "github",
      repository: snapshot.repository,
      schemaVersion: REPOSITORY_BINDING_SCHEMA_VERSION,
      snapshotId: SNAPSHOT_ID,
    });

    expect(() =>
      repositorySnapshotSchema.parse({ ...snapshot, unexpected: true }),
    ).toThrow();
    expect(() =>
      repositorySnapshotSchema.parse({
        ...snapshot,
        manifestHash: "d".repeat(64),
      }),
    ).toThrow("manifest hash");
    expect(() =>
      assertRepositoryBindingMatchesSnapshot({
        binding: { ...binding, baseSha: "e".repeat(40) },
        snapshot,
        snapshotId: SNAPSHOT_ID,
      }),
    ).toThrow("does not match");
    expect(() =>
      assertRepositoryBindingMatchesSnapshot({
        binding,
        snapshot,
        snapshotId: SNAPSHOT_ID,
      }),
    ).not.toThrow();
  });

  test("accepts internal branch slashes and rejects invalid Git refs", () => {
    expect(githubBranchSchema.parse("feature/foo")).toBe("feature/foo");

    for (const invalidBranch of [
      "/feature",
      "feature/",
      "feature//foo",
      "feature\\foo",
      "feature..foo",
      "feature/@{foo",
      ".hidden",
      "feature/.hidden",
      "feature.lock",
      "feature/foo.lock",
      "@",
    ]) {
      expect(() => githubBranchSchema.parse(invalidBranch)).toThrow();
    }
  });

  test("fails closed on a different hash for one snapshot identity", () => {
    expect(
      resolveMatchingSnapshotId({
        existing: { id: SNAPSHOT_ID, manifestHash: "a".repeat(64) },
        manifestHash: "a".repeat(64),
      }),
    ).toBe(SNAPSHOT_ID);
    expect(() =>
      resolveMatchingSnapshotId({
        existing: { id: SNAPSHOT_ID, manifestHash: "a".repeat(64) },
        manifestHash: "b".repeat(64),
      }),
    ).toThrow(DeterministicRepositorySnapshotConflictError);
  });
});

describe("GitHub archive workspace", () => {
  test("extracts a pinned repository archive without system Git", async () => {
    const archiveFixture = await createRepositoryDirectory();
    const archiveRoot = path.join(archiveFixture, "repository-root");
    const archivePath = path.join(archiveFixture, "repository.tar.gz");
    await mkdir(path.join(archiveRoot, "src"), { recursive: true });
    await writeFile(
      path.join(archiveRoot, "src", "index.ts"),
      "export const value = 1;\n",
    );
    await createTarArchive(
      {
        cwd: archiveFixture,
        file: archivePath,
        gzip: true,
      },
      ["repository-root"],
    );
    const archive = await readFile(archivePath);
    const fetchImplementation = vi.fn(async () =>
      new Response(archive, { status: 200 }),
    );
    const repository = parseGitHubRepository(REPOSITORY_URL);

    expect(repository).not.toBeNull();

    const workspace = await createReadOnlyGitHubArchiveWorkspace({
      baseSha: COMMIT_SHA,
      fetchImplementation,
      installationToken: "installation-token",
      repository: repository!,
    });
    temporaryDirectories.push(workspace.rootDirectory);

    expect(
      await readFile(
        path.join(workspace.workspaceDirectory, "src", "index.ts"),
        "utf8",
      ),
    ).toBe("export const value = 1;\n");
    expect(fetchImplementation).toHaveBeenCalledWith(
      `https://api.github.com/repos/acme/example/tarball/${COMMIT_SHA}`,
      expect.objectContaining({
        redirect: "follow",
      }),
    );

    await workspace.cleanup();
    await expect(
      readFile(path.join(workspace.workspaceDirectory, "src", "index.ts")),
    ).rejects.toThrow();
  });
});

describe("read-only repository scanner", () => {
  test("is repeatable, deterministically sorted, and ignores outputs and symlinks", async () => {
    const rootPath = await createRepositoryDirectory();
    const externalPath = await createRepositoryDirectory();
    await Promise.all([
      mkdir(path.join(rootPath, "src")),
      mkdir(path.join(rootPath, "node_modules")),
      mkdir(path.join(rootPath, "dist")),
    ]);
    await Promise.all([
      writeFile(path.join(rootPath, "z.ts"), "export const z = true;\n"),
      writeFile(path.join(rootPath, "src", "a.ts"), "export const a = true;\n"),
      writeFile(path.join(rootPath, "node_modules", "ignored.js"), "ignored\n"),
      writeFile(path.join(rootPath, "dist", "ignored.js"), "ignored\n"),
      writeFile(path.join(externalPath, "secret.txt"), "secret\n"),
    ]);
    await symlink(
      path.join(externalPath, "secret.txt"),
      path.join(rootPath, "linked-secret.txt"),
    );

    const firstManifest = await scanFixture(rootPath);
    const secondManifest = await scanFixture(rootPath);

    expect(secondManifest).toEqual(firstManifest);
    expect(firstManifest.files.map(({ path: filePath }) => filePath)).toEqual([
      "src/a.ts",
      "z.ts",
    ]);
  });

  test("fails closed when file-count or total-byte limits are exceeded", async () => {
    const rootPath = await createRepositoryDirectory();
    await Promise.all([
      writeFile(path.join(rootPath, "a.txt"), "12345"),
      writeFile(path.join(rootPath, "b.txt"), "67890"),
    ]);

    await expect(
      scanRepository({
        expectedCommitSha: COMMIT_SHA,
        limits: { maxFileCount: 1 },
        rootPath,
        source: { kind: "github", ref: COMMIT_SHA, url: REPOSITORY_URL },
      }),
    ).rejects.toThrow("file scan limit");
    await expect(
      scanRepository({
        expectedCommitSha: COMMIT_SHA,
        limits: { maxTotalBytes: 9 },
        rootPath,
        source: { kind: "github", ref: COMMIT_SHA, url: REPOSITORY_URL },
      }),
    ).rejects.toThrow("byte scan limit");
  });
});

describe("repository capture preflight", () => {
  const createCaptureHarness = async ({
    branchSha = COMMIT_SHA,
    cleanupFailure = false,
    installationAvailable = true,
    installationPermissionsValid = true,
    revokeFailure = false,
  }: {
    branchSha?: string;
    cleanupFailure?: boolean;
    installationAvailable?: boolean;
    installationPermissionsValid?: boolean;
    revokeFailure?: boolean;
  } = {}) => {
    const rootPath = await createRepositoryDirectory();
    await writeFile(path.join(rootPath, "package.json"), '{"name":"example"}\n');
    const tokenPurposes: string[] = [];
    const revokedTokens: string[] = [];
    const persistenceOrder: string[] = [];
    const requestPaths: string[] = [];
    const cleanup = vi.fn(async () => {
      if (cleanupFailure) {
        throw new Error("workspace cleanup failed");
      }
    });
    const getInstallation = vi.fn(async () => ({
      accountId: 55,
      accountLogin: "acme",
      accountType: "Organization",
      appId: 123,
      appSlug: "outcomes-test",
      installationId: 987,
      permissions: {
        actions: "write",
        contents: installationPermissionsValid ? "write" : "read",
        pull_requests: "write",
      },
      repositorySelection: "selected" as const,
      suspendedAt: null,
    }));
    const findInstallation = vi.fn(async () =>
      installationAvailable
        ? {
            appId: 123,
            disconnectedAt: null,
            id: INSTALLATION_ROW_ID,
            installationId: 987,
            permissions: {
              actions: "write",
              contents: installationPermissionsValid ? "write" : "read",
              pull_requests: "write",
            },
            suspendedAt: null,
            userId: USER_ID,
          }
        : null,
    );

    const capture = createRepositoryCaptureService({
      appClient: {
        createInstallationToken: async ({ purpose }) => {
          tokenPurposes.push(purpose);
          return {
            expiresAt: "2026-07-31T01:00:00.000Z",
            token: `${purpose}-token`,
          };
        },
        getInstallation,
      },
      createId: vi
        .fn()
        .mockReturnValueOnce(SNAPSHOT_ID)
        .mockReturnValueOnce(BINDING_ID),
      createInstallationClient: (token) => ({
        request: async <Result,>(requestPath: string): Promise<Result> => {
          requestPaths.push(requestPath);

          if (requestPath === "/repos/acme/example") {
            return {
              full_name: "Acme/Example",
              html_url: REPOSITORY_URL,
              id: 77,
              visibility: "private",
            } as Result;
          }

          if (requestPath.includes("/git/ref/heads/")) {
            return {
              object: { sha: branchSha, type: "commit" },
            } as Result;
          }

          if (requestPath.includes("/git/commits/")) {
            return {
              sha: COMMIT_SHA,
              tree: { sha: TREE_SHA },
            } as Result;
          }

          throw new Error(`Unexpected GitHub request: ${requestPath}`);
        },
        revokeToken: async () => {
          if (revokeFailure) {
            throw new Error(`${token} revocation failed`);
          }

          revokedTokens.push(token);
        },
      }),
      createWorkspace: async () => ({
        cleanup,
        gitDirectory: path.join(rootPath, ".git-metadata"),
        rootDirectory: rootPath,
        workspaceDirectory: rootPath,
      }),
      scanner: {
        id: REPOSITORY_SCANNER_ID,
        scan: scanRepository,
        version: REPOSITORY_SCANNER_VERSION,
      },
      store: {
        findInstallation,
        persistBinding: async ({ id }) => {
          persistenceOrder.push("binding");
          return id;
        },
        persistSnapshot: async ({ id }) => {
          persistenceOrder.push("snapshot");
          return id;
        },
      },
    });

    return {
      capture,
      cleanup,
      findInstallation,
      getInstallation,
      persistenceOrder,
      requestPaths,
      revokedTokens,
      tokenPurposes,
    };
  };

  const captureInput = {
    baseBranch: "main",
    baseSha: COMMIT_SHA,
    repositoryUrl: REPOSITORY_URL,
    storedInstallationId: INSTALLATION_ROW_ID,
    userId: USER_ID,
  };

  test("captures and persists an exact immutable snapshot before its binding", async () => {
    const harness = await createCaptureHarness();
    const result = await harness.capture(captureInput);

    expect(result.snapshot.commitSha).toBe(COMMIT_SHA);
    expect(result.snapshot.treeSha).toBe(TREE_SHA);
    expect(result.binding.snapshotId).toBe(SNAPSHOT_ID);
    expect(harness.persistenceOrder).toEqual(["snapshot", "binding"]);
    expect(harness.tokenPurposes).toEqual(["discover", "scan"]);
    expect(harness.revokedTokens).toEqual(
      expect.arrayContaining(["discover-token", "scan-token"]),
    );
    expect(harness.cleanup).toHaveBeenCalledOnce();
  });

  test("validates branches before access and encodes valid internal slashes", async () => {
    const validHarness = await createCaptureHarness();
    await validHarness.capture({
      ...captureInput,
      baseBranch: "feature/foo",
    });
    expect(validHarness.requestPaths).toContain(
      "/repos/acme/example/git/ref/heads/feature%2Ffoo",
    );

    const invalidHarness = await createCaptureHarness();
    await expect(
      invalidHarness.capture({
        ...captureInput,
        baseBranch: "feature//foo",
      }),
    ).rejects.toThrow("valid GitHub base branch");
    expect(invalidHarness.findInstallation).not.toHaveBeenCalled();
    expect(invalidHarness.getInstallation).not.toHaveBeenCalled();
    expect(invalidHarness.persistenceOrder).toEqual([]);
  });

  test("rejects stale branch heads and still revokes discovery access", async () => {
    const harness = await createCaptureHarness({
      branchSha: "f".repeat(40),
    });

    await expect(harness.capture(captureInput)).rejects.toMatchObject({
      code: "base_ref_mismatch",
    });
    expect(harness.persistenceOrder).toEqual([]);
    expect(harness.tokenPurposes).toEqual(["discover"]);
    expect(harness.revokedTokens).toEqual(["discover-token"]);
  });

  test("surfaces cleanup failure after a successful capture", async () => {
    const harness = await createCaptureHarness({ cleanupFailure: true });
    let capturedError: unknown;

    try {
      await harness.capture(captureInput);
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(AggregateError);
    expect((capturedError as AggregateError).errors).toHaveLength(1);
    expect(
      ((capturedError as AggregateError).errors[0] as Error).message,
    ).toBe("workspace cleanup failed");
    expect(harness.persistenceOrder).toEqual(["snapshot", "binding"]);
  });

  test("aggregates operation and cleanup failures without losing either", async () => {
    const harness = await createCaptureHarness({
      branchSha: "f".repeat(40),
      revokeFailure: true,
    });
    let capturedError: unknown;

    try {
      await harness.capture(captureInput);
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(AggregateError);
    const errors = (capturedError as AggregateError).errors as Error[];
    expect(errors.map(({ message }) => message)).toEqual([
      "The repository base branch does not point to the requested immutable SHA.",
      "discover-token revocation failed",
    ]);
  });

  test("rejects installations not owned by the requesting user", async () => {
    const harness = await createCaptureHarness({
      installationAvailable: false,
    });

    await expect(harness.capture(captureInput)).rejects.toMatchObject({
      code: "installation_not_owned",
    });
    expect(harness.tokenPurposes).toEqual([]);
  });

  test("rejects insufficient installation permissions with a typed error", async () => {
    const harness = await createCaptureHarness({
      installationPermissionsValid: false,
    });

    await expect(harness.capture(captureInput)).rejects.toMatchObject({
      code: "installation_permissions_invalid",
    });
    expect(harness.getInstallation).not.toHaveBeenCalled();
    expect(harness.tokenPurposes).toEqual([]);
  });
});

describe("repository persistence migration contract", () => {
  test("declares atomic versioned installation claiming and immutable ownership", async () => {
    const migration = await readFile(
      path.join(
        process.cwd(),
        "supabase/migrations/20260730141502_repository_bindings_and_snapshots.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("add column disconnected_at timestamptz");
    expect(migration).toContain(
      "drop constraint github_app_installations_app_id_account_id_key",
    );
    expect(migration).toMatch(
      /unique index github_app_installations_one_active_generation_idx[\s\S]*where disconnected_at is null/u,
    );
    expect(migration).toContain(
      "create function public.claim_github_app_installation(",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration.toLowerCase()).not.toContain("security definer");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("and user_id <> p_user_id");
    expect(migration).toContain("if v_generation_exists then");
    expect(migration).toContain("disconnected_at = null");
    expect(migration).toContain(
      "GitHub App installation identity is immutable",
    );
    expect(migration).toMatch(
      /revoke all on function public[.]claim_github_app_installation\([\s\S]*from public, anon, authenticated, service_role;/u,
    );
    expect(migration).toMatch(
      /grant execute on function public[.]claim_github_app_installation\([\s\S]*\) to service_role;/u,
    );
  });

  test("pins snapshot semantics, ownership FKs, RLS, grants, and immutability", async () => {
    const migration = await readFile(
      path.join(
        process.cwd(),
        "supabase/migrations/20260730141502_repository_bindings_and_snapshots.sql",
      ),
      "utf8",
    );
    const semanticKey = migration.match(
      /constraint repository_snapshots_semantic_key unique \(([\s\S]*?)\n  \),/u,
    )?.[1];

    expect(semanticKey).toBeDefined();
    for (const column of [
      "user_id",
      "github_repository_id",
      "repository_url",
      "repository_full_name",
      "visibility",
      "commit_sha",
      "tree_sha",
      "scanner_id",
      "scanner_version",
    ]) {
      expect(semanticKey).toContain(column);
    }
    expect(semanticKey).not.toContain("manifest_hash");
    expect(migration).toContain(
      "constraint repository_bindings_installation_owner_fkey foreign key",
    );
    expect(migration).toMatch(
      /foreign key \(\s*github_app_installation_id,\s*user_id,\s*github_installation_id\s*\)/u,
    );
    expect(migration).toContain(
      "constraint repository_bindings_snapshot_owner_fkey foreign key",
    );
    expect(migration).toMatch(
      /foreign key \(\s*snapshot_id,\s*user_id,\s*manifest_hash,\s*github_repository_id,\s*base_sha,\s*repository_url,\s*repository_full_name,\s*visibility\s*\)/u,
    );
    expect(migration).toContain(
      "before update on public.repository_snapshots",
    );
    expect(migration).toContain(
      "before update on public.repository_bindings",
    );
    expect(migration).toMatch(
      /to authenticated\s+using \(\(select auth[.]uid\(\)\) = user_id\);/u,
    );
    expect(migration).toContain(
      'create policy "repository_snapshots_select_own"',
    );
    expect(migration).toContain(
      'create policy "repository_bindings_select_own"',
    );
    expect(migration).toContain(
      "grant select, insert on table public.repository_snapshots to service_role",
    );
    expect(migration).toContain(
      "grant select, insert on table public.repository_bindings to service_role",
    );
    expect(migration).not.toMatch(
      /grant (insert|update|delete)[^;]*to authenticated/iu,
    );
  });
});
