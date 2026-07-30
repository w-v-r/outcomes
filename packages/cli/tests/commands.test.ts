import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { OutcomesClientError } from "@outcomes/client";
import {
  CLI_EXIT,
  exitCodeForStatusQuery,
  mapApiErrorToCliExit,
  type CustomerTask,
} from "@outcomes/contracts";
import { describe, expect, test, vi } from "vitest";

import { parseCliArgs } from "../src/cli.js";
import { runAccept } from "../src/commands/accept.js";
import { runQuote } from "../src/commands/quote-assess.js";
import { createBindingQuote } from "../src/commands/quote-flow.js";
import { runRepoInspect } from "../src/commands/repo-inspect.js";
import { runRun } from "../src/commands/run.js";
import { runStatus } from "../src/commands/status.js";
import { createCliContext } from "../src/context.js";
import { createStateStore } from "../src/config/state.js";
import {
  type GitExecutor,
} from "../src/git/discovery.js";
import { mapClientErrorToExit } from "../src/exit-mapping.js";
import {
  formatQuoteHuman,
  formatTaskOutcomeHuman,
} from "../src/output/format.js";
import * as tty from "../src/tty.js";
import type { OutcomesClient } from "@outcomes/client";

const TEST_API_KEY =
  "outcomes_test_aabbccddeeff_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const headSha = "4aff18a256039f727b54d3cc48b65e8e8eab7bb7";
const bindingId = "33333333-3333-4333-8333-333333333333";
const quoteId = "11111111-1111-4111-8111-111111111111";
const taskId = "44444444-4444-4444-8444-444444444444";
const contractHash = "c".repeat(64);

const task = {
  acceptanceCriteria: ["Tests pass."],
  description: "Fix the fixture",
  prohibitedChanges: ["Do not delete tests"],
};

const installation = {
  account: { login: "acme", type: "Organization" as const },
  created_at: "2026-07-31T00:00:00.000Z",
  installation_generation_id: "22222222-2222-4222-8222-222222222222",
  repository_selection: "selected" as const,
  status: "active" as const,
};

const binding = {
  base_branch: "main",
  base_sha: headSha,
  id: bindingId,
  manifest_hash: "b".repeat(64),
  repository: {
    full_name: "acme/example",
    github_repository_id: 99,
    url: "https://github.com/acme/example",
    visibility: "private" as const,
  },
  snapshot_id: "55555555-5555-4555-8555-555555555555",
};

const snapshotQuote = {
  amount_cents: 1250,
  contract_hash: contractHash,
  currency: "AUD" as const,
  eligibility: { code: "eligible", eligible: true },
  expires_at: "2026-07-31T00:00:00.000Z",
  id: quoteId,
  pricing: {
    caveat:
      "Planning estimate from a deterministic, uncalibrated policy; not a delivery guarantee.",
    confidence: "medium" as const,
    estimator: { id: "est", version: "1" },
    estimatorDecision: "accept" as const,
    executionConditions: ["Keep CI green"],
    factors: ["bounded task"],
    policyVersion: "2.0.0",
    range: { currency: "AUD" as const, highCents: 2000, lowCents: 1000 },
  },
  pricing_evidence_hash: "d".repeat(64),
  pricing_model_version: "2.0.0",
  replayed: false,
  repository: {
    base_branch: "main",
    base_sha: headSha,
    binding_id: bindingId,
    full_name: "acme/example",
    github_repository_id: 99,
    manifest_hash: "b".repeat(64),
    snapshot_id: "55555555-5555-4555-8555-555555555555",
    url: "https://github.com/acme/example",
  },
  repository_sha: headSha,
  repository_url: "https://github.com/acme/example",
  status: "pending" as const,
  task,
  task_id: null,
  terms: "Customer-visible terms for approval.",
};

const rejectedQuote = {
  ...snapshotQuote,
  eligibility: {
    code: "task_not_allowed",
    eligible: false,
    reason: "Fixture rejection",
  },
  status: "rejected" as const,
};

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

const createDefaultGit = (): GitExecutor =>
  createGitStub({
    "ls-remote origin refs/heads/main": `${headSha}\trefs/heads/main`,
    "remote get-url origin": "https://github.com/acme/example",
    "rev-parse HEAD": headSha,
    "rev-parse --show-toplevel": "/tmp/repo",
    "status --porcelain": "",
    "symbolic-ref --short HEAD": "main",
  });

const createTestContext = (input: {
  client: Partial<OutcomesClient>;
  git?: GitExecutor;
  json?: boolean;
  stateDirectory: string;
}) => {
  process.env.OUTCOMES_API_KEY = TEST_API_KEY;
  process.env.OUTCOMES_API_BASE_URL = "http://127.0.0.1:9";

  const client = input.client as OutcomesClient;

  return createCliContext(
    {
      json: input.json ?? false,
      stateDirectory: input.stateDirectory,
    },
    undefined,
    {
      client,
      git: input.git ?? createDefaultGit(),
      state: createStateStore(input.stateDirectory),
    },
  );
};

const captureStdout = () => {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });

  return {
    restore: () => spy.mockRestore(),
    text: () => chunks.join(""),
  };
};

describe("CLI command flows", () => {
  test("human status shows retry scheduling and claim evidence", () => {
    const retryingTask = {
      agent_id: null,
      completed_at: null,
      created_at: "2026-07-31T00:00:00.000Z",
      execution: {
        claim_count: 2,
        completed_at: null,
        customer_error_code: "retry_scheduled",
        customer_error_message:
          "A temporary execution failure will be retried automatically.",
        failure_count: 1,
        id: "77777777-7777-4777-8777-777777777777",
        next_attempt_at: "2026-07-31T00:01:00.000Z",
        started_at: null,
        state: "retry_wait" as const,
      },
      failure: null,
      id: taskId,
      output: { branch: null, pr_url: null, ref: null },
      payment: null,
      quote_id: quoteId,
      repository_sha: headSha,
      repository_url: binding.repository.url,
      run_id: null,
      started_at: null,
      status: "starting",
      task,
      timeline: [],
      updated_at: "2026-07-31T00:00:00.000Z",
      usage: null,
      verified_at: null,
      verifier: {
        conclusion: null,
        evidence: null,
        run_id: null,
        status: null,
      },
      worker_model: null,
    } satisfies CustomerTask;

    expect(formatTaskOutcomeHuman(retryingTask)).toContain(
      "Execution: retry_wait",
    );
    expect(formatTaskOutcomeHuman(retryingTask)).toContain(
      "Claims: 2",
    );
    expect(formatTaskOutcomeHuman(retryingTask)).toContain(
      "Next attempt: 2026-07-31T00:01:00.000Z",
    );
  });

  test("rejected quote exits 4 and is not treated as a network failure", async () => {
    const stateDirectory = mkdtempSync(
      path.join(os.tmpdir(), "outcomes-cli-cmd-"),
    );
    const createQuote = vi.fn().mockResolvedValue({ quote: rejectedQuote });
    const context = createTestContext({
      client: {
        captureRepositoryBinding: vi.fn().mockResolvedValue({ binding }),
        createQuote,
        listInstallations: vi.fn().mockResolvedValue({ installations: [installation] }),
      },
      stateDirectory,
    });

    const exitCode = await runQuote(
      context,
      { acceptance: task.acceptanceCriteria, prohibited: task.prohibitedChanges, task: task.description },
      {},
    );

    expect(exitCode).toBe(CLI_EXIT.rejected);
    expect(createQuote).toHaveBeenCalledTimes(1);
  });

  test("quote and run reuse the same idempotency key for identical binding/task", async () => {
    const stateDirectory = mkdtempSync(
      path.join(os.tmpdir(), "outcomes-cli-cmd-"),
    );
    const createQuote = vi.fn().mockResolvedValue({ quote: snapshotQuote });
    const client = {
      acceptQuote: vi.fn(),
      captureRepositoryBinding: vi.fn().mockResolvedValue({ binding }),
      createQuote,
      getTaskStatus: vi.fn(),
      listInstallations: vi.fn().mockResolvedValue({ installations: [installation] }),
    };
    const context = createTestContext({ client, stateDirectory });

    await createBindingQuote(
      context,
      { acceptance: task.acceptanceCriteria, prohibited: task.prohibitedChanges, task: task.description },
      {},
    );
    await createBindingQuote(
      context,
      { acceptance: task.acceptanceCriteria, prohibited: task.prohibitedChanges, task: task.description },
      {},
    );

    expect(createQuote).toHaveBeenCalledTimes(2);
    expect(createQuote.mock.calls[0]?.[0].idempotency_key).toBe(
      createQuote.mock.calls[1]?.[0].idempotency_key,
    );
  });

  test("run --json emits exactly one JSON document", async () => {
    const stateDirectory = mkdtempSync(
      path.join(os.tmpdir(), "outcomes-cli-cmd-"),
    );
    const stdout = captureStdout();
    const context = createTestContext({
      client: {
        acceptQuote: vi.fn().mockResolvedValue({
          task: { status: "executing", task_id: taskId },
        }),
        captureRepositoryBinding: vi.fn().mockResolvedValue({ binding }),
        createQuote: vi.fn().mockResolvedValue({ quote: snapshotQuote }),
        getTaskStatus: vi.fn().mockResolvedValue({
          task: {
            id: taskId,
            output: { branch: null, pr_url: null, ref: null },
            payment: null,
            status: "completed",
          },
        }),
        listInstallations: vi.fn().mockResolvedValue({ installations: [installation] }),
      },
      json: true,
      stateDirectory,
    });

    const exitCode = await runRun(context, {
      acceptance: task.acceptanceCriteria,
      contractHash,
      prohibited: task.prohibitedChanges,
      task: task.description,
      watchIntervalMs: 10,
      watchTimeoutMs: 5000,
      yes: true,
    });

    stdout.restore();
    const document = stdout.text().trim();
    expect(() => JSON.parse(document)).not.toThrow();
    expect(document.startsWith("{")).toBe(true);
    expect(document.endsWith("}")).toBe(true);
    expect(document.match(/\}\s*\{/gu)).toBeNull();
    const parsed = JSON.parse(document) as {
      accept: unknown;
      quote: unknown;
      status: unknown;
    };
    expect(exitCode).toBe(CLI_EXIT.success);
    expect(parsed.quote).toBeTruthy();
    expect(parsed.accept).toBeTruthy();
    expect(parsed.status).toBeTruthy();
  });

  test("non-TTY approval without --yes is declined", async () => {
    const stateDirectory = mkdtempSync(
      path.join(os.tmpdir(), "outcomes-cli-cmd-"),
    );
    vi.spyOn(tty, "isInteractiveInput").mockReturnValue(false);

    const context = createTestContext({
      client: {
        acceptQuote: vi.fn(),
        captureRepositoryBinding: vi.fn(),
        createQuote: vi.fn(),
        listInstallations: vi.fn(),
      },
      stateDirectory,
    });

    const result = await runAccept(context, {
      contractHash,
      quoteId,
      yes: false,
    });

    vi.restoreAllMocks();
    expect(result.exitCode).toBe(CLI_EXIT.declined);
  });

  test("non-TTY run with mismatched contract hash is declined", async () => {
    const stateDirectory = mkdtempSync(
      path.join(os.tmpdir(), "outcomes-cli-cmd-"),
    );
    const stdout = captureStdout();
    const context = createTestContext({
      client: {
        captureRepositoryBinding: vi.fn().mockResolvedValue({ binding }),
        createQuote: vi.fn().mockResolvedValue({ quote: snapshotQuote }),
        listInstallations: vi.fn().mockResolvedValue({ installations: [installation] }),
      },
      json: true,
      stateDirectory,
    });

    const exitCode = await runRun(context, {
      acceptance: task.acceptanceCriteria,
      contractHash: "f".repeat(64),
      prohibited: task.prohibitedChanges,
      task: task.description,
      watchIntervalMs: 10,
      watchTimeoutMs: 1000,
      yes: true,
    });

    stdout.restore();
    const document = stdout.text().trim();
    expect(document.length).toBeGreaterThan(0);
    const parsed = JSON.parse(document) as {
      error: { code: string; message: string };
      quote: unknown;
    };
    expect(parsed.error.code).toBe("declined");
    expect(parsed.quote).toBeTruthy();
    expect(exitCode).toBe(CLI_EXIT.declined);
  });

  test("human quote output includes customer-visible approval fields", () => {
    const rendered = formatQuoteHuman(snapshotQuote);

    expect(rendered).toContain(`Quote ID: ${quoteId}`);
    expect(rendered).toContain(`Contract hash: ${contractHash}`);
    expect(rendered).toContain("Binding ID:");
    expect(rendered).toContain("Manifest hash:");
    expect(rendered).toContain("Factors:");
    expect(rendered).toContain(task.description);
    expect(rendered).toContain("Customer-visible terms");
  });

  test("repo inspect propagates installation auth failures", async () => {
    const stateDirectory = mkdtempSync(
      path.join(os.tmpdir(), "outcomes-cli-cmd-"),
    );
    const context = createTestContext({
      client: {
        captureRepositoryBinding: vi.fn(),
        listInstallations: vi.fn().mockRejectedValue(
          new OutcomesClientError({
            apiCode: "invalid_api_key",
            code: "api_error",
            httpStatus: 401,
            message: "Invalid API key.",
          }),
        ),
      },
      git: createDefaultGit(),
      stateDirectory,
    });

    const exitCode = await runRepoInspect(context, {});

    expect(exitCode).toBe(CLI_EXIT.auth);
  });

  test("one-shot status query for running task exits 0", async () => {
    const stateDirectory = mkdtempSync(
      path.join(os.tmpdir(), "outcomes-cli-cmd-"),
    );
    const context = createTestContext({
      client: {
        getTaskStatus: vi.fn().mockResolvedValue({
          task: {
            id: taskId,
            output: { branch: null, pr_url: null, ref: null },
            payment: null,
            status: "executing",
            verifier: { conclusion: null, status: null },
          },
        }),
      },
      json: true,
      stateDirectory,
    });

    const result = await runStatus(context, {
      intervalMs: 100,
      taskId,
      timeoutMs: 1000,
      watch: false,
    });

    expect(result.exitCode).toBe(exitCodeForStatusQuery());
    expect(result.exitCode).toBe(0);
  });

  test("central exit mapping covers auth, repository, rejected, and network", () => {
    expect(
      mapApiErrorToCliExit({ apiCode: "unauthorized", httpStatus: 401 }),
    ).toBe(CLI_EXIT.auth);
    expect(
      mapApiErrorToCliExit({
        apiCode: "repository_installation_not_found",
        httpStatus: 404,
      }),
    ).toBe(CLI_EXIT.repository);
    expect(
      mapApiErrorToCliExit({ apiCode: "billing_not_ready", httpStatus: 409 }),
    ).toBe(CLI_EXIT.rejected);
    expect(
      mapClientErrorToExit(
        new OutcomesClientError({
          code: "network",
          message: "offline",
        }),
      ),
    ).toBe(CLI_EXIT.network);
  });

  test("parseCliArgs rejects missing option values and extra trailing options", () => {
    expect(() => parseCliArgs(["quote", "--base"])).toThrow(/Missing value/u);
    expect(() => parseCliArgs(["status", "task-id", "--watch", "--json"])).not.toThrow();
  });
});

describe("state store hardening", () => {
  test("fails closed on corrupted state JSON", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "outcomes-cli-state-"));
    writeFileSync(path.join(directory, "state.json"), "{not-json", "utf8");

    expect(() => createStateStore(directory).getOperation("quote:test")).toThrow(
      /corrupted/u,
    );
  });

  test("rejects idempotency override after scope is bound", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "outcomes-cli-state-"));
    const store = createStateStore(directory);
    const fingerprint = "a".repeat(64);

    store.resolveIdempotencyKey({
      bodyFingerprint: fingerprint,
      requestedOverride: "customer-quote-001",
      scope: "quote:bound",
    });

    expect(() =>
      store.resolveIdempotencyKey({
        bodyFingerprint: fingerprint,
        requestedOverride: "customer-quote-002",
        scope: "quote:bound",
      }),
    ).toThrow(/override rejected/u);
  });
});
