import { spawn } from "node:child_process";
import type { VerificationResult } from "./domain.js";

const MAX_CAPTURED_OUTPUT_BYTES = 128_000;

const appendBounded = (current: string, chunk: Buffer): string => {
  if (current.length >= MAX_CAPTURED_OUTPUT_BYTES) return current;
  return (current + chunk.toString("utf8")).slice(0, MAX_CAPTURED_OUTPUT_BYTES);
};

export const runVerifier = async (
  command: string,
  cwd: string,
  timeoutMs = 120_000,
): Promise<VerificationResult> => new Promise((resolve) => {
  const startedAt = Date.now();
  const child = spawn(command, {
    cwd,
    shell: true,
    env: { ...process.env, CI: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let settled = false;

  child.stdout.on("data", (chunk: Buffer) => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = appendBounded(stderr, chunk);
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
  }, timeoutMs);

  const finish = (exitCode: number | null, spawnError?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (spawnError) stderr = appendBounded(stderr, Buffer.from(spawnError.message));
    resolve({
      command,
      passed: !spawnError && !timedOut && exitCode === 0,
      exitCode,
      durationMs: Date.now() - startedAt,
      stdout,
      stderr,
      timedOut,
    });
  };

  child.on("error", (error) => finish(null, error));
  child.on("close", (code) => finish(code));
});
