import { OutcomesClientError } from "@outcomes/client";
import { CLI_EXIT } from "@outcomes/contracts";

import { runAccept } from "./commands/accept.js";
import { runAuthStatus } from "./commands/auth-status.js";
import { runAssess, runQuote } from "./commands/quote-assess.js";
import { runRepoInspect } from "./commands/repo-inspect.js";
import { runRun } from "./commands/run.js";
import { runStatus } from "./commands/status.js";
import {
  createCliContext,
  type GlobalCliOptions,
} from "./context.js";
import { mapClientErrorToExit } from "./exit-mapping.js";
import { logInfo } from "./output/format.js";
import {
  CliAbortError,
  resolveInterruptedExitCode,
  type InterruptedSignal,
} from "./signal.js";
import type { TaskInputOptions } from "./task/parse-task-input.js";
import {
  parseOptionalUuid,
  parseRequiredContractHash,
  parseRequiredUuid,
  rejectUnexpectedPositionals,
  rejectUnexpectedSubcommand,
} from "./validation.js";

const HELP = `Outcomes CLI — hosted REST adapter (no local pricing)

Usage:
  outcomes auth status
  outcomes repo inspect [--base <branch>] [--installation <uuid>] [--json]
  outcomes assess [--task-file <path> | --task <text> --acceptance <text> ... --prohibited <text> ...] [--base <branch>] [--installation <uuid>] [--idempotency-key <key>] [--json]
  outcomes quote  [same task and repository flags as assess]
  outcomes accept <quote-id> --contract-hash <sha256> [--idempotency-key <key>] [--yes] [--json]
  outcomes status <task-id> [--watch] [--interval <ms>] [--timeout <ms>] [--json]
  outcomes run    [same flags as quote] [--yes --contract-hash <sha256>] [--interval <ms>] [--timeout <ms>] [--json]

Environment:
  OUTCOMES_API_KEY       Required Bearer token from the Outcomes dashboard
  OUTCOMES_API_BASE_URL  API origin (default https://outcomes-chi.vercel.app)

Exit codes:
  0 success  1 usage  2 auth  3 repository  4 rejected  5 declined
  6 worker  7 verification  8 payment  9 network  10 internal  11 timeout
  130 SIGINT  143 SIGTERM
`;

type ParsedArgs = {
  acceptance: string[];
  base?: string;
  command: string[];
  contractHash?: string;
  idempotencyKey?: string;
  installation?: string;
  intervalMs: number;
  json: boolean;
  localOnly: boolean;
  prohibited: string[];
  remote?: string;
  stateDirectory?: string;
  task?: string;
  taskFile?: string;
  timeoutMs: number;
  watch: boolean;
  yes: boolean;
};

const requireOptionValue = (flag: string, value: string | undefined) => {
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
};

const parsePositiveFiniteMs = (value: string, flag: string): number => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive finite number of milliseconds.`);
  }

  return parsed;
};

export const parseCliArgs = (argv: string[]): ParsedArgs => {
  const parsed: ParsedArgs = {
    acceptance: [],
    command: [],
    intervalMs: 5_000,
    json: !process.stdout.isTTY,
    localOnly: false,
    prohibited: [],
    timeoutMs: 3_600_000,
    watch: false,
    yes: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--json") {
      parsed.json = true;
      continue;
    }

    if (token === "--help" || token === "-h") {
      parsed.command = ["help"];
      continue;
    }

    if (token === "--yes") {
      parsed.yes = true;
      continue;
    }

    if (token === "--watch") {
      parsed.watch = true;
      continue;
    }

    if (token === "--local-only") {
      parsed.localOnly = true;
      continue;
    }

    if (token === "--remote") {
      parsed.remote = requireOptionValue("--remote", argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--base") {
      parsed.base = requireOptionValue("--base", argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--installation") {
      parsed.installation = requireOptionValue(
        "--installation",
        argv[index + 1],
      );
      index += 1;
      continue;
    }

    if (token === "--task") {
      parsed.task = requireOptionValue("--task", argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--task-file") {
      parsed.taskFile = requireOptionValue("--task-file", argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--acceptance") {
      parsed.acceptance.push(
        requireOptionValue("--acceptance", argv[index + 1]),
      );
      index += 1;
      continue;
    }

    if (token === "--prohibited") {
      parsed.prohibited.push(
        requireOptionValue("--prohibited", argv[index + 1]),
      );
      index += 1;
      continue;
    }

    if (token === "--contract-hash") {
      parsed.contractHash = requireOptionValue(
        "--contract-hash",
        argv[index + 1],
      );
      index += 1;
      continue;
    }

    if (token === "--idempotency-key") {
      parsed.idempotencyKey = requireOptionValue(
        "--idempotency-key",
        argv[index + 1],
      );
      index += 1;
      continue;
    }

    if (token === "--state-dir") {
      parsed.stateDirectory = requireOptionValue(
        "--state-dir",
        argv[index + 1],
      );
      index += 1;
      continue;
    }

    if (token === "--interval") {
      parsed.intervalMs = parsePositiveFiniteMs(
        requireOptionValue("--interval", argv[index + 1]),
        "--interval",
      );
      index += 1;
      continue;
    }

    if (token === "--timeout") {
      parsed.timeoutMs = parsePositiveFiniteMs(
        requireOptionValue("--timeout", argv[index + 1]),
        "--timeout",
      );
      index += 1;
      continue;
    }

    if (token.startsWith("-")) {
      throw new Error(`Unknown option ${token}`);
    }

    parsed.command.push(token);
  }

  return parsed;
};

const taskOptionsFromParsed = (parsed: ParsedArgs): TaskInputOptions => ({
  acceptance: parsed.acceptance,
  contractFile: parsed.taskFile,
  prohibited: parsed.prohibited,
  task: parsed.task,
});

export type RunCliOptions = {
  hooks?: {
    interruptedSignal?: InterruptedSignal | null;
  };
};

export const runCli = async (
  argv: string[],
  options: RunCliOptions = {},
): Promise<number> => {
  let parsed: ParsedArgs;

  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    logInfo(error instanceof Error ? error.message : "Invalid arguments.");
    logInfo(HELP);
    return CLI_EXIT.usage;
  }

  if (parsed.command.length > 0 && parsed.command[parsed.command.length - 1]?.startsWith("-")) {
    logInfo("Unexpected trailing option. Check command syntax.");
    logInfo(HELP);
    return CLI_EXIT.usage;
  }

  if (parsed.command[0] === "help" || parsed.command.length === 0) {
    logInfo(HELP);
    return CLI_EXIT.success;
  }

  const abortController = new AbortController();
  let interruptedSignal: "SIGINT" | "SIGTERM" | null = null;
  const handleSigint = () => {
    interruptedSignal = "SIGINT";
    abortController.abort();
  };
  const handleSigterm = () => {
    interruptedSignal = "SIGTERM";
    abortController.abort();
  };
  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);

  const globalOptions: GlobalCliOptions = {
    idempotencyKey: parsed.idempotencyKey,
    json: parsed.json,
    stateDirectory: parsed.stateDirectory,
  };

  let context;

  try {
    context = createCliContext(globalOptions, abortController.signal);
  } catch (error) {
    logInfo(error instanceof Error ? error.message : "Configuration failed.");
    return CLI_EXIT.auth;
  }

  const signal = abortController.signal;

  try {
    const repoOptions = {
      base: parsed.base,
      installation: parseOptionalUuid(parsed.installation, "--installation"),
      localOnly: parsed.localOnly,
      remote: parsed.remote,
    };

    const contractHash = parsed.contractHash
      ? parseRequiredContractHash(parsed.contractHash)
      : undefined;

    const [group, subcommand, ...rest] = parsed.command;

    if (group === "auth") {
      if (subcommand !== "status") {
        throw new Error("Usage: outcomes auth status");
      }

      rejectUnexpectedPositionals(rest, "auth status");
      return await runAuthStatus(context, signal);
    }

    if (group === "repo") {
      if (subcommand !== "inspect") {
        throw new Error("Usage: outcomes repo inspect");
      }

      rejectUnexpectedPositionals(rest, "repo inspect");
      return await runRepoInspect(context, repoOptions, signal);
    }

    if (group === "assess") {
      rejectUnexpectedSubcommand(subcommand, "assess");
      rejectUnexpectedPositionals(rest, "assess");
      return await runAssess(
        context,
        taskOptionsFromParsed(parsed),
        repoOptions,
        signal,
      );
    }

    if (group === "quote") {
      rejectUnexpectedSubcommand(subcommand, "quote");
      rejectUnexpectedPositionals(rest, "quote");
      return await runQuote(
        context,
        taskOptionsFromParsed(parsed),
        repoOptions,
        signal,
      );
    }

    if (group === "accept") {
      rejectUnexpectedPositionals(rest, "accept");

      if (!subcommand) {
        logInfo("Usage: outcomes accept <quote-id> --contract-hash <sha256>");
        return CLI_EXIT.usage;
      }

      const quoteId = parseRequiredUuid(subcommand, "quote-id");

      const acceptResult = await runAccept(context, {
        contractHash,
        idempotencyKey: parsed.idempotencyKey,
        quoteId,
        signal,
        yes: parsed.yes,
      });

      return acceptResult.exitCode;
    }

    if (group === "status") {
      rejectUnexpectedPositionals(rest, "status");

      if (!subcommand) {
        logInfo("Usage: outcomes status <task-id> [--watch]");
        return CLI_EXIT.usage;
      }

      const taskId = parseRequiredUuid(subcommand, "task-id");

      const statusResult = await runStatus(context, {
        intervalMs: parsed.intervalMs,
        signal,
        taskId,
        timeoutMs: parsed.timeoutMs,
        watch: parsed.watch,
      });

      return statusResult.exitCode;
    }

    if (group === "run") {
      rejectUnexpectedSubcommand(subcommand, "run");
      rejectUnexpectedPositionals(rest, "run");
      return await runRun(context, {
        ...taskOptionsFromParsed(parsed),
        ...repoOptions,
        contractHash,
        signal,
        watchIntervalMs: parsed.intervalMs,
        watchTimeoutMs: parsed.timeoutMs,
        yes: parsed.yes,
      });
    }

    logInfo(`Unknown command: ${parsed.command.join(" ")}`);
    logInfo(HELP);
    return CLI_EXIT.usage;
  } catch (error) {
    if (error instanceof CliAbortError) {
      return resolveInterruptedExitCode(
        options.hooks?.interruptedSignal ?? interruptedSignal,
      );
    }

    if (abortController.signal.aborted) {
      return resolveInterruptedExitCode(
        options.hooks?.interruptedSignal ?? interruptedSignal,
      );
    }

    if (error instanceof OutcomesClientError) {
      if (error.code === "abort") {
        return resolveInterruptedExitCode(
          options.hooks?.interruptedSignal ?? interruptedSignal,
        );
      }

      logInfo(error.message);
      return mapClientErrorToExit(error);
    }

    if (error instanceof Error) {
      logInfo(error.message);
      return CLI_EXIT.usage;
    }

    logInfo("Unexpected failure.");
    return mapClientErrorToExit(error);
  } finally {
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
  }
};
