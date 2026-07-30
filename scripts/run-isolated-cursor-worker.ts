import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  executeIsolatedCursorRun,
  type IsolatedCursorRunInput,
} from "../src/lib/workers/isolated/cursor-run";

const readStandardInput = async (): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
};

const requireValue = (
  value: string | undefined,
  flag: string,
): string => {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new Error(`${flag} is required.`);
  }

  return normalizedValue;
};

const main = async () => {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      input: { type: "string" },
      output: { type: "string" },
    },
    strict: true,
  });
  const inputPath = requireValue(values.input, "--input");
  const outputPath = requireValue(values.output, "--output");
  const apiKey = (await readStandardInput()).trim();

  if (!apiKey) {
    throw new Error("The isolated worker Cursor credential is missing.");
  }

  const input = JSON.parse(
    await readFile(inputPath, "utf8"),
  ) as IsolatedCursorRunInput;
  const result = await executeIsolatedCursorRun({ apiKey, input });

  await writeFile(outputPath, JSON.stringify(result), {
    encoding: "utf8",
    mode: 0o600,
  });

  if (result.status !== "finished") {
    process.exitCode = 2;
  }
};

main().catch((error: unknown) => {
  process.stderr.write(
    `${
      error instanceof Error
        ? error.message
        : "Unknown isolated Cursor worker failure."
    }\n`,
  );
  process.exitCode = 1;
});
