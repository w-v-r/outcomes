#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_MAX_FILE_BYTES = 128_000;
const DEFAULT_MAX_TOOL_CALLS = 40;
const BLOCKED_PATH_SEGMENTS = [
  "/.git/",
  "/dist/",
  "/node_modules/",
  "/vendor/",
];

const readStdin = async () => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input);
};

const output = (result) => {
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

const deny = (message) => output({
  permission: "deny",
  user_message: message,
  agent_message: `${message} Use a targeted search, smaller source file, or stop and report the constraint.`,
});

const safeIdentifier = (value) => String(value ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");

const incrementToolCount = async (input) => {
  const statePath = join(
    input.cwd ?? process.cwd(),
    ".repo-cost",
    "hook-state",
    `${safeIdentifier(input.session_id ?? input.conversation_id)}.json`,
  );
  await mkdir(dirname(statePath), { recursive: true });
  let count = 0;
  try {
    count = JSON.parse(await readFile(statePath, "utf8")).count ?? 0;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  count += 1;
  await writeFile(statePath, JSON.stringify({ count, updatedAt: new Date().toISOString() }));
  return count;
};

const main = async () => {
  const input = await readStdin();
  const eventName = input.hook_event_name;

  if (eventName === "beforeReadFile") {
    const filePath = String(input.file_path ?? "").replaceAll("\\", "/");
    const bytes = Buffer.byteLength(String(input.content ?? ""), "utf8");
    const maxBytes = Number(process.env.REPO_COST_MAX_FILE_BYTES ?? DEFAULT_MAX_FILE_BYTES);
    if (BLOCKED_PATH_SEGMENTS.some((segment) => filePath.includes(segment))) {
      deny(`Read denied for excluded path: ${filePath}`);
      return;
    }
    if (bytes > maxBytes) {
      deny(`Read denied because ${filePath} is ${bytes} bytes; limit is ${maxBytes}.`);
      return;
    }
    output({ permission: "allow" });
    return;
  }

  if (eventName === "subagentStart" || input.tool_name === "Task") {
    deny("Subagents are disabled for this cost-bounded benchmark.");
    return;
  }

  if (eventName === "preToolUse") {
    const count = await incrementToolCount(input);
    const maxToolCalls = Number(process.env.REPO_COST_MAX_TOOL_CALLS ?? DEFAULT_MAX_TOOL_CALLS);
    if (count > maxToolCalls) {
      deny(`Tool-call limit exceeded: ${count} calls attempted; limit is ${maxToolCalls}.`);
      return;
    }
  }

  output({ permission: "allow" });
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
