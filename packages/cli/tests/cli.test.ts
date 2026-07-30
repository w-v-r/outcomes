import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  createStateStore,
  fingerprintJson,
} from "../src/config/state.js";
import {
  RepositoryDiscoveryError,
  discoverRepository,
  type GitExecutor,
} from "../src/git/discovery.js";
import { CLI_EXIT, exitCodeForTaskStatus } from "@outcomes/contracts";

const createGitStub = (responses: Record<string, string>): GitExecutor => ({
  exec: (args) => {
    const key = args.join(" ");
    const value = responses[key];

    if (value === undefined) {
      throw new Error(`missing git stub for ${key}`);
    }

    return value;
  },
});

describe("git discovery", () => {
  test("normalizes SSH origin and requires remote sync for executable flows", () => {
    const head = "a".repeat(40);
    const discovery = discoverRepository({
      baseBranch: "main",
      cwd: "/tmp/repo",
      git: createGitStub({
        "ls-remote origin refs/heads/main": `${head}\trefs/heads/main`,
        "remote get-url origin": "git@github.com:acme/example.git",
        "rev-parse HEAD": head,
        "rev-parse --show-toplevel": "/tmp/repo",
        "status --porcelain": "",
        "symbolic-ref --short HEAD": "main",
      }),
      requireRemoteSynced: true,
    });

    expect(discovery.repositoryUrl).toBe(
      "https://github.com/acme/example",
    );
  });

  test("rejects dirty worktrees by default", () => {
    expect(() =>
      discoverRepository({
        cwd: "/tmp/repo",
        git: createGitStub({
          "rev-parse --show-toplevel": "/tmp/repo",
          "status --porcelain": " M README.md",
          "remote get-url origin": "https://github.com/acme/example",
        }),
      }),
    ).toThrow(RepositoryDiscoveryError);
  });

  test("rejects unpushed HEAD", () => {
    const head = "a".repeat(40);
    const remote = "b".repeat(40);

    expect(() =>
      discoverRepository({
        baseBranch: "main",
        cwd: "/tmp/repo",
        git: createGitStub({
          "ls-remote origin refs/heads/main": `${remote}\trefs/heads/main`,
          "remote get-url origin": "https://github.com/acme/example",
          "rev-parse HEAD": head,
          "rev-parse --show-toplevel": "/tmp/repo",
          "status --porcelain": "",
          "symbolic-ref --short HEAD": "main",
        }),
        requireRemoteSynced: true,
      }),
    ).toThrow(/does not match/u);
  });
});

describe("state store", () => {
  test("reuses idempotency keys for identical bodies", () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), "outcomes-cli-state-"),
    );
    const store = createStateStore(directory);
    const body = { task: "demo" };
    const fingerprint = fingerprintJson(body);
    const first = store.resolveIdempotencyKey({
      bodyFingerprint: fingerprint,
      scope: "quote:test",
    });

    store.putOperation("quote:test", {
      bodyFingerprint: fingerprint,
      idempotencyKey: first,
      updatedAt: new Date().toISOString(),
    });

    const second = store.resolveIdempotencyKey({
      bodyFingerprint: fingerprint,
      scope: "quote:test",
    });

    expect(second).toBe(first);
  });

  test("refuses changed bodies for the same scope", () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), "outcomes-cli-state-"),
    );
    const store = createStateStore(directory);
    const first = store.resolveIdempotencyKey({
      bodyFingerprint: fingerprintJson({ a: 1 }),
      scope: "quote:test",
    });

    store.putOperation("quote:test", {
      bodyFingerprint: fingerprintJson({ a: 1 }),
      idempotencyKey: first,
      updatedAt: new Date().toISOString(),
    });

    expect(() =>
      store.resolveIdempotencyKey({
        bodyFingerprint: fingerprintJson({ a: 2 }),
        scope: "quote:test",
      }),
    ).toThrow(/different/u);
  });
});

describe("terminal exit mapping", () => {
  test("maps verification failure to exit code 7", () => {
    expect(exitCodeForTaskStatus("verification_failed")).toBe(
      CLI_EXIT.verification,
    );
  });
});
