import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type IsolatedCursorRunInput,
  type IsolatedCursorRunResult,
} from "@/lib/workers/isolated/cursor-run";

const MAX_WORKER_RUNTIME_MILLISECONDS = 30 * 60 * 1_000;

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
}: {
  apiKey: string;
  environment: NodeJS.ProcessEnv;
  inputPath: string;
  outputPath: string;
}): Promise<void> => {
  const workerScriptPath = path.join(
    process.cwd(),
    "scripts/run-isolated-cursor-worker.ts",
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      workerScriptPath,
      "--input",
      inputPath,
      "--output",
      outputPath,
    ],
    {
      env: environment,
      shell: false,
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
  let standardError = "";
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, MAX_WORKER_RUNTIME_MILLISECONDS);

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    standardError += chunk;
  });
  child.stdin.end(apiKey);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => {
    clearTimeout(timeout);
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
}: {
  apiKey: string;
  input: IsolatedCursorRunInput;
  rootDirectory: string;
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
  });

  return JSON.parse(
    await readFile(outputPath, "utf8"),
  ) as IsolatedCursorRunResult;
};
