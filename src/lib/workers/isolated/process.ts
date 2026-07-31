import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type IsolatedCursorRunInput,
  type IsolatedCursorRunResult,
} from "@/lib/workers/isolated/cursor-run";

export const MAX_WORKER_RUNTIME_MILLISECONDS = 8 * 60 * 1_000;
const WORKER_KILL_GRACE_MILLISECONDS = 5_000;

export const createIsolatedWorkerEnvironment = ({
  nodeEnvironment,
  pathValue,
  rootDirectory,
  workerHome,
}: {
  nodeEnvironment: NodeJS.ProcessEnv["NODE_ENV"];
  pathValue: string;
  rootDirectory: string;
  workerHome: string;
}): NodeJS.ProcessEnv => ({
  HOME: workerHome,
  LANG: "C.UTF-8",
  NODE_ENV: nodeEnvironment,
  PATH: pathValue,
  TERM: "dumb",
  TMPDIR: rootDirectory,
});

const runWorkerProcess = async ({
  apiKey,
  environment,
  inputPath,
  outputPath,
  signal,
}: {
  apiKey: string;
  environment: NodeJS.ProcessEnv;
  inputPath: string;
  outputPath: string;
  signal?: AbortSignal;
}): Promise<void> => {
  if (signal?.aborted) {
    throw new Error("The isolated worker was aborted before launch.");
  }

  const workerScriptPath = path.join(
    process.cwd(),
    "scripts/run-isolated-cursor-worker.bundle.mjs",
  );
  const child = spawn(
    process.execPath,
    [workerScriptPath, "--input", inputPath, "--output", outputPath],
    {
      env: environment,
      shell: false,
      signal,
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
  const exitPromise = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  let standardError = "";
  let forceKillTimer: NodeJS.Timeout | null = null;
  const terminateChild = () => {
    if (child.exitCode !== null || child.killed) {
      return;
    }

    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, WORKER_KILL_GRACE_MILLISECONDS);
    forceKillTimer.unref();
  };
  const timeout = setTimeout(() => {
    terminateChild();
  }, MAX_WORKER_RUNTIME_MILLISECONDS);
  const handleAbort = () => terminateChild();
  signal?.addEventListener("abort", handleAbort, { once: true });
  if (signal?.aborted) {
    terminateChild();
  }

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    standardError += chunk;
  });
  child.stdin.end(apiKey);

  const exitCode = await exitPromise.finally(() => {
    clearTimeout(timeout);
    if (forceKillTimer) {
      clearTimeout(forceKillTimer);
    }
    signal?.removeEventListener("abort", handleAbort);
  });

  if (exitCode !== 0) {
    throw new Error(
      `The isolated Cursor worker exited with code ${exitCode ?? "unknown"}: ${standardError.slice(-1_000)}`,
    );
  }
};

export const executeIsolatedCursorProcess = async ({
  apiKey,
  input,
  rootDirectory,
  signal,
}: {
  apiKey: string;
  input: IsolatedCursorRunInput;
  rootDirectory: string;
  signal?: AbortSignal;
}): Promise<IsolatedCursorRunResult> => {
  const workerHome = path.join(rootDirectory, "worker-home");
  const inputPath = path.join(rootDirectory, "worker-input.json");
  const outputPath = path.join(rootDirectory, "worker-output.json");

  await mkdir(workerHome, { mode: 0o700 });
  await writeFile(inputPath, JSON.stringify(input), {
    encoding: "utf8",
    mode: 0o600,
  });
  await runWorkerProcess({
    apiKey,
    environment: createIsolatedWorkerEnvironment({
      nodeEnvironment: process.env.NODE_ENV,
      pathValue: process.env.PATH ?? "/usr/bin:/bin",
      rootDirectory,
      workerHome,
    }),
    inputPath,
    outputPath,
    signal,
  });

  return JSON.parse(
    await readFile(outputPath, "utf8"),
  ) as IsolatedCursorRunResult;
};
