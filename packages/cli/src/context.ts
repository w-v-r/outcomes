import { OutcomesClient } from "@outcomes/client";

import {
  assertStateDirectoryPermissions,
  createStateStore,
  resolveStateDirectory,
  type StateStore,
} from "./config/state.js";
import { loadEnvironment, requireApiKey } from "./config/env.js";
import { createNodeGitExecutor, type GitExecutor } from "./git/discovery.js";
import type { OutputMode } from "./output/format.js";

export type GlobalCliOptions = {
  idempotencyKey?: string;
  json: boolean;
  stateDirectory?: string;
};

export type CliContextOverrides = {
  client?: OutcomesClient;
  git?: GitExecutor;
  state?: StateStore;
};

export type CliContext = {
  abortSignal?: AbortSignal;
  client: OutcomesClient;
  environment: ReturnType<typeof loadEnvironment>;
  git: GitExecutor;
  options: GlobalCliOptions;
  outputMode: OutputMode;
  state: StateStore;
};

export const createCliContext = (
  options: GlobalCliOptions,
  abortSignal?: AbortSignal,
  overrides: CliContextOverrides = {},
): CliContext => {
  const environment = loadEnvironment();
  const apiKey = requireApiKey(environment);
  const stateDirectory =
    options.stateDirectory ?? resolveStateDirectory();

  assertStateDirectoryPermissions(stateDirectory);

  return {
    abortSignal,
    client:
      overrides.client ??
      new OutcomesClient({
        apiKey,
        baseUrl: environment.baseUrl,
      }),
    environment,
    git: overrides.git ?? createNodeGitExecutor(),
    options,
    outputMode: options.json ? "json" : "human",
    state: overrides.state ?? createStateStore(stateDirectory),
  };
};
