import { beforeEach, describe, expect, test, vi } from "vitest";

import { CLI_EXIT } from "@outcomes/contracts";

const runAcceptMock = vi.fn();
const runAuthStatusMock = vi.fn();

vi.mock("../src/context.js", () => ({
  createCliContext: vi.fn(() => ({
    client: {},
    environment: { apiKey: "test", baseUrl: "http://127.0.0.1:9" },
    git: { exec: vi.fn() },
    options: {},
    outputMode: "human",
    state: {
      getOperation: vi.fn(),
      getTask: vi.fn(),
      putBinding: vi.fn(),
      putOperation: vi.fn(),
      putTask: vi.fn(),
      resolveIdempotencyKey: vi.fn(),
    },
  })),
}));

vi.mock("../src/commands/accept.js", () => ({
  runAccept: (...args: unknown[]) => runAcceptMock(...args),
}));

vi.mock("../src/commands/auth-status.js", () => ({
  runAuthStatus: (...args: unknown[]) => runAuthStatusMock(...args),
}));

import { runCli } from "../src/cli.js";
import { CliAbortError } from "../src/signal.js";

const quoteId = "11111111-1111-4111-8111-111111111111";
const contractHash = "c".repeat(64);
const TEST_API_KEY =
  "outcomes_test_aabbccddeeff_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("runCli", () => {
  beforeEach(() => {
    process.env.OUTCOMES_API_KEY = TEST_API_KEY;
    process.env.OUTCOMES_API_BASE_URL = "http://127.0.0.1:9";
    runAcceptMock.mockReset();
    runAcceptMock.mockResolvedValue({ exitCode: CLI_EXIT.success });
    runAuthStatusMock.mockReset();
    runAuthStatusMock.mockResolvedValue(CLI_EXIT.success);
  });

  test("routes accept quote id from the subcommand positional", async () => {
    const exitCode = await runCli([
      "accept",
      quoteId,
      "--contract-hash",
      contractHash,
      "--yes",
    ]);

    expect(exitCode).toBe(CLI_EXIT.success);
    expect(runAcceptMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quoteId }),
    );
  });

  test("rejects extra positional arguments for accept", async () => {
    const exitCode = await runCli([
      "accept",
      quoteId,
      "extra-id",
      "--contract-hash",
      contractHash,
      "--yes",
    ]);

    expect(exitCode).toBe(CLI_EXIT.usage);
    expect(runAcceptMock).not.toHaveBeenCalled();
  });

  test("rejects invalid quote UUIDs at the CLI boundary", async () => {
    const exitCode = await runCli([
      "accept",
      "not-a-uuid",
      "--contract-hash",
      contractHash,
      "--yes",
    ]);

    expect(exitCode).toBe(CLI_EXIT.usage);
    expect(runAcceptMock).not.toHaveBeenCalled();
  });

  test("maps CliAbortError to SIGTERM exit 143", async () => {
    runAuthStatusMock.mockRejectedValueOnce(new CliAbortError());

    const exitCode = await runCli(["auth", "status"], {
      hooks: { interruptedSignal: "SIGTERM" },
    });

    expect(exitCode).toBe(CLI_EXIT.terminated);
  });

  test("maps CliAbortError to SIGINT exit 130", async () => {
    runAuthStatusMock.mockRejectedValueOnce(new CliAbortError());

    const exitCode = await runCli(["auth", "status"], {
      hooks: { interruptedSignal: "SIGINT" },
    });

    expect(exitCode).toBe(CLI_EXIT.signal);
  });
});
