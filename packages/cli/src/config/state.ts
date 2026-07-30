import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

const STATE_VERSION = 1 as const;
const LOCK_RETRIES = 40;
const LOCK_DELAY_MS = 25;

const stateRecordSchema = z
  .object({
    bodyFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    idempotencyKey: z.string().min(8).max(160),
    updatedAt: z.string(),
  })
  .strict();

const cliStateFileSchema = z
  .object({
    bindings: z.record(
      z.string(),
      z.object({
        bindingId: z.string().uuid(),
        manifestHash: z.string(),
      }),
    ),
    operations: z.record(z.string(), stateRecordSchema),
    tasks: z.record(
      z.string(),
      z.object({
        quoteId: z.string().uuid().optional(),
        taskId: z.string().uuid(),
      }),
    ),
    version: z.literal(STATE_VERSION),
  })
  .strict();

export type StateRecord = z.infer<typeof stateRecordSchema>;
export type CliStateFile = z.infer<typeof cliStateFileSchema>;

export type StateStore = {
  getOperation: (scope: string) => StateRecord | null;
  getTask: (scope: string) => { quoteId?: string; taskId: string } | null;
  putBinding: (key: string, bindingId: string, manifestHash: string) => void;
  putOperation: (scope: string, record: StateRecord) => void;
  putTask: (scope: string, taskId: string, quoteId?: string) => void;
  resolveIdempotencyKey: (input: {
    bodyFingerprint: string;
    requestedOverride?: string;
    scope: string;
  }) => string;
};

const sleepSync = (ms: number) => {
  const end = Date.now() + ms;

  while (Date.now() < end) {
    /* spin */
  }
};

export const resolveStateDirectory = (homeDir = os.homedir()): string => {
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ??
      path.join(homeDir, "AppData", "Local");

    return path.join(localAppData, "Outcomes", "state");
  }

  const stateHome =
    process.env.XDG_STATE_HOME ?? path.join(homeDir, ".local", "state");

  return path.join(stateHome, "outcomes");
};

const ensurePrivateDirectory = (directory: string) => {
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  if (existsSync(directory)) {
    chmodSync(directory, 0o700);
  }
};

const acquireLockSync = (lockPath: string): (() => void) => {
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      const lockDescriptor = openSync(lockPath, "wx", 0o600);
      writeSync(lockDescriptor, `${process.pid}\n`);
      fsyncSync(lockDescriptor);
      closeSync(lockDescriptor);

      return () => {
        try {
          unlinkSync(lockPath);
        } catch {
          /* lock already released */
        }
      };
    } catch {
      sleepSync(LOCK_DELAY_MS);
    }
  }

  throw new Error(
    `State store lock could not be acquired at ${lockPath}. Another Outcomes CLI process may be running.`,
  );
};

const readValidatedState = (statePath: string): CliStateFile => {
  if (!existsSync(statePath)) {
    return {
      bindings: {},
      operations: {},
      tasks: {},
      version: STATE_VERSION,
    };
  }

  let raw: string;

  try {
    raw = readFileSync(statePath, "utf8");
  } catch (error) {
    throw new Error("State file could not be read.", { cause: error });
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      "State file is corrupted or invalid JSON. Remove it or repair it before continuing.",
      { cause: error },
    );
  }

  const validated = cliStateFileSchema.safeParse(parsed);

  if (!validated.success) {
    throw new Error(
      "State file schema/version mismatch. Remove the state file or migrate it before continuing.",
    );
  }

  return validated.data;
};

const writeValidatedState = (statePath: string, state: CliStateFile) => {
  const directory = path.dirname(statePath);
  const temporaryPath = path.join(
    directory,
    `.state-${randomBytes(8).toString("hex")}.tmp`,
  );
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  const fileDescriptor = openSync(temporaryPath, "w", 0o600);
  let closed = false;

  try {
    writeFileSync(fileDescriptor, serialized, "utf8");
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    closed = true;
  } catch (error) {
    if (!closed) {
      try {
        closeSync(fileDescriptor);
      } catch {
        /* ignore secondary close failure */
      }
    }

    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      /* ignore cleanup failure */
    }

    throw error;
  }

  try {
    renameSync(temporaryPath, statePath);
    chmodSync(statePath, 0o600);
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      /* ignore cleanup failure */
    }

    throw error;
  }
};

const withLockedStateSync = <T>(
  directory: string,
  mutate: (state: CliStateFile) => T,
): T => {
  ensurePrivateDirectory(directory);
  const statePath = path.join(directory, "state.json");
  const lockPath = path.join(directory, "state.lock");
  const release = acquireLockSync(lockPath);

  try {
    const state = readValidatedState(statePath);
    const result = mutate(state);
    writeValidatedState(statePath, state);
    return result;
  } finally {
    release();
  }
};

export const createStateStore = (directory: string): StateStore => ({
  getOperation: (scope) => {
    const statePath = path.join(directory, "state.json");
    return readValidatedState(statePath).operations[scope] ?? null;
  },
  getTask: (scope) => {
    const statePath = path.join(directory, "state.json");
    return readValidatedState(statePath).tasks[scope] ?? null;
  },
  putBinding: (key, bindingId, manifestHash) => {
    withLockedStateSync(directory, (state) => {
      state.bindings[key] = { bindingId, manifestHash };
    });
  },
  putOperation: (scope, record) => {
    withLockedStateSync(directory, (state) => {
      state.operations[scope] = record;
    });
  },
  putTask: (scope, taskId, quoteId) => {
    withLockedStateSync(directory, (state) => {
      state.tasks[scope] = { quoteId, taskId };
    });
  },
  resolveIdempotencyKey: ({ bodyFingerprint, requestedOverride, scope }) =>
    withLockedStateSync(directory, (state) => {
      const existing = state.operations[scope];

      if (existing) {
        if (existing.bodyFingerprint !== bodyFingerprint) {
          throw new Error(
            `A previous ${scope} attempt used a different request body.`,
          );
        }

        if (
          requestedOverride &&
          requestedOverride !== existing.idempotencyKey
        ) {
          throw new Error(
            `Idempotency key override rejected because ${scope} is already bound to a persisted key.`,
          );
        }

        return existing.idempotencyKey;
      }

      const idempotencyKey =
        requestedOverride ??
        `outcomes-${scope.replace(/:/gu, "-")}-${randomBytes(12).toString("hex")}`;

      state.operations[scope] = {
        bodyFingerprint,
        idempotencyKey,
        updatedAt: new Date().toISOString(),
      };

      return idempotencyKey;
    }),
});

export const fingerprintJson = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

export const assertStateDirectoryPermissions = (directory: string) => {
  ensurePrivateDirectory(directory);

  if (!existsSync(directory)) {
    return;
  }

  const mode = statSync(directory).mode & 0o777;

  if (mode !== 0o700) {
    chmodSync(directory, 0o700);
  }
};
