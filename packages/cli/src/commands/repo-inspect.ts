import { parseGitHubRepository } from "@outcomes/contracts";
import { OutcomesClientError } from "@outcomes/client";

import {
  RepositoryDiscoveryError,
  discoverRepository,
} from "../git/discovery.js";
import type { CliContext } from "../context.js";
import { mapClientErrorToExit, CLI_EXIT } from "../exit-mapping.js";
import { logInfo, writeJson } from "../output/format.js";

export type RepoInspectOptions = {
  base?: string;
  installation?: string;
  localOnly?: boolean;
  remote?: string;
  requireRemoteSynced?: boolean;
};

export const resolveInstallationId = async (
  context: CliContext,
  repositoryUrl: string,
  installationOverride?: string,
  signal?: AbortSignal,
): Promise<string> => {
  if (installationOverride) {
    return installationOverride;
  }

  const { installations } = await context.client.listInstallations(signal);
  const active = installations.filter((item) => item.status === "active");
  const repository = parseGitHubRepository(repositoryUrl);

  if (!repository) {
    throw new Error("Repository URL could not be parsed for installation matching.");
  }

  const ownerMatches = active.filter(
    (item) =>
      item.account.login.toLowerCase() === repository.owner.toLowerCase(),
  );

  if (ownerMatches.length === 1) {
    return ownerMatches[0]!.installation_generation_id;
  }

  if (active.length === 1) {
    return active[0]!.installation_generation_id;
  }

  if (active.length === 0) {
    throw new OutcomesClientError({
      apiCode: "repository_installation_not_found",
      code: "api_error",
      httpStatus: 404,
      message:
        "No active GitHub App installation was found. Install the Outcomes GitHub App from the dashboard, then pass --installation.",
    });
  }

  throw new Error(
    "Multiple active GitHub App installations were found. Pass --installation with installation_generation_id from outcomes repo inspect.",
  );
};

export const captureBindingForDiscovery = async (
  context: CliContext,
  input: RepoInspectOptions & { signal?: AbortSignal },
) => {
  const discovery = discoverRepository({
    allowDirty: false,
    baseBranch: input.base,
    git: context.git,
    remoteName: input.remote,
    requireRemoteSynced: input.requireRemoteSynced ?? true,
  });
  const storedInstallationId = await resolveInstallationId(
    context,
    discovery.repositoryUrl,
    input.installation,
    input.signal,
  );
  const captureBody = {
    base_branch: discovery.baseBranch,
    base_sha: discovery.headSha,
    repository_url: discovery.repositoryUrl,
    stored_installation_id: storedInstallationId,
  };
  const bindingKey = `${discovery.repositoryUrl}:${discovery.headSha}:${discovery.baseBranch}`;
  const captureResult = await context.client.captureRepositoryBinding(
    captureBody,
    input.signal,
  );

  context.state.putBinding(
    bindingKey,
    captureResult.binding.id,
    captureResult.binding.manifest_hash,
  );

  return {
    bindingId: captureResult.binding.id,
    capture: captureResult,
    discovery,
    storedInstallationId,
  };
};

export const runRepoInspect = async (
  context: CliContext,
  options: RepoInspectOptions,
  signal?: AbortSignal,
): Promise<number> => {
  try {
    if (options.localOnly) {
      const discovery = discoverRepository({
        allowDirty: true,
        baseBranch: options.base,
        git: context.git,
        remoteName: options.remote,
        requireRemoteSynced: false,
      });

      const payload = {
        base_branch: discovery.baseBranch,
        dirty: discovery.dirty,
        git_root: discovery.gitRoot,
        head_sha: discovery.headSha,
        mode: "local-only" as const,
        remote_branch_sha: discovery.remoteBranchSha,
        remote_name: discovery.remoteName,
        remote_url: discovery.remoteUrl,
        repository_url: discovery.repositoryUrl,
        synced_with_remote:
          discovery.remoteBranchSha === discovery.headSha,
      };

      if (context.outputMode === "json") {
        writeJson(payload);
      } else {
        logInfo(`Git root: ${payload.git_root}`);
        logInfo(`Repository: ${payload.repository_url}`);
        logInfo(`Remote: ${payload.remote_name}`);
        logInfo(`HEAD: ${payload.head_sha}`);
        logInfo(`Dirty: ${payload.dirty ? "yes" : "no"}`);
      }

      return CLI_EXIT.success;
    }

    const { capture, discovery, storedInstallationId } =
      await captureBindingForDiscovery(context, {
        ...options,
        requireRemoteSynced: true,
        signal,
      });
    const { installations } = await context.client.listInstallations(signal);

    const payload = {
      base_branch: discovery.baseBranch,
      binding: capture.binding,
      dirty: discovery.dirty,
      git_root: discovery.gitRoot,
      head_sha: discovery.headSha,
      installations,
      mode: "preflight" as const,
      remote_branch_sha: discovery.remoteBranchSha,
      remote_name: discovery.remoteName,
      remote_url: discovery.remoteUrl,
      repository_url: discovery.repositoryUrl,
      selected_installation_id: storedInstallationId,
      synced_with_remote: true,
    };

    if (context.outputMode === "json") {
      writeJson(payload);
      return CLI_EXIT.success;
    }

    logInfo(`Git root: ${payload.git_root}`);
    logInfo(`Repository: ${payload.repository_url}`);
    logInfo(`Remote: ${payload.remote_name} (${payload.remote_url})`);
    logInfo(`Base branch: ${payload.base_branch}`);
    logInfo(`HEAD: ${payload.head_sha}`);
    logInfo(`Remote branch tip: ${payload.remote_branch_sha}`);
    logInfo(`Installation: ${payload.selected_installation_id}`);
    logInfo(`Binding ID: ${payload.binding.id}`);
    logInfo(`Snapshot ID: ${payload.binding.snapshot_id}`);
    logInfo(`Manifest hash: ${payload.binding.manifest_hash}`);

    return CLI_EXIT.success;
  } catch (error) {
    if (error instanceof RepositoryDiscoveryError) {
      if (context.outputMode === "json") {
        writeJson({ error: { code: error.code, message: error.message } });
      } else {
        logInfo(error.message);
      }

      return CLI_EXIT.repository;
    }

    if (error instanceof OutcomesClientError) {
      logInfo(error.message);
      return mapClientErrorToExit(error);
    }

    logInfo(error instanceof Error ? error.message : "Repository inspect failed.");
    return CLI_EXIT.repository;
  }
};
