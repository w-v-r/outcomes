import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  GitHubAppClient,
  GitHubInstallationClient,
  requireGitHubRepository,
} from "../src/lib/github-app/client";
import { getGitHubAppConfig } from "../src/lib/github-app/config";
import { runGitHubAppWorkerSpike } from "../src/lib/workers/isolated/github-app-spike";

const MAX_PROMPT_BYTES = 20_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

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

const requireInstallationId = (value: string | undefined): number => {
  const normalizedValue = requireValue(value, "--installation-id");

  if (!/^[1-9][0-9]*$/u.test(normalizedValue)) {
    throw new Error("--installation-id must be a positive integer.");
  }

  const installationId = Number(normalizedValue);

  if (!Number.isSafeInteger(installationId)) {
    throw new Error("--installation-id exceeds the safe integer range.");
  }

  return installationId;
};

const printJson = (value: unknown) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const main = async () => {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      "allow-path": { multiple: true, type: "string" },
      base: { type: "string" },
      "confirm-write": { type: "string" },
      execute: { default: false, type: "boolean" },
      "installation-id": { type: "string" },
      "prompt-file": { type: "string" },
      repository: { type: "string" },
      sha: { type: "string" },
    },
    strict: true,
  });
  const installationId = requireInstallationId(values["installation-id"]);
  const repository = requireGitHubRepository(
    requireValue(values.repository, "--repository"),
  );
  const baseBranch = requireValue(values.base, "--base");
  const baseSha = requireValue(values.sha, "--sha").toLowerCase();

  if (!SHA_PATTERN.test(baseSha)) {
    throw new Error("--sha must be a full 40-character Git commit SHA.");
  }

  if (!values.execute) {
    const appClient = new GitHubAppClient({
      config: getGitHubAppConfig(),
    });
    const installationToken = await appClient.createInstallationToken({
      installationId,
      purpose: "discover",
      repository,
    });
    const client = new GitHubInstallationClient({
      token: installationToken.token,
    });

    try {
      const [repositoryDetails, commit, baseRef] = await Promise.all([
        client.request<{
          default_branch: string;
          full_name: string;
          private: boolean;
        }>(`/repos/${repository.fullName}`),
        client.request<{ sha: string }>(
          `/repos/${repository.fullName}/git/commits/${baseSha}`,
        ),
        client.request<{ object: { sha: string } }>(
          `/repos/${repository.fullName}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
        ),
      ]);

      printJson({
        base_branch: baseBranch,
        base_branch_sha: baseRef.object.sha,
        installation_id: installationId,
        mode: "read_only",
        pinned_sha: commit.sha,
        repository: repositoryDetails.full_name,
        repository_default_branch: repositoryDetails.default_branch,
        repository_private: repositoryDetails.private,
        stale: baseRef.object.sha !== baseSha,
      });
    } finally {
      await client.revokeToken();
    }

    return;
  }

  const confirmation = requireValue(
    values["confirm-write"],
    "--confirm-write",
  );

  if (confirmation !== repository.url) {
    throw new Error(
      "--confirm-write must exactly match the normalized repository URL.",
    );
  }

  const promptPath = requireValue(values["prompt-file"], "--prompt-file");
  const prompt = (await readFile(promptPath, "utf8")).trim();

  if (!prompt) {
    throw new Error("The worker prompt file is empty.");
  }

  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw new Error(`The worker prompt exceeds ${MAX_PROMPT_BYTES} bytes.`);
  }

  const allowedPaths = values["allow-path"] ?? [];

  if (allowedPaths.length === 0) {
    throw new Error("At least one --allow-path is required for execution.");
  }

  const result = await runGitHubAppWorkerSpike({
    allowedPaths,
    baseBranch,
    baseSha,
    installationId,
    prompt,
    repositoryUrl: repository.url,
  });

  printJson({
    installation_id: result.installationId,
    mode: "write_probe_finished",
    publication: result.publication,
    repository_id: result.repositoryId,
    repository_url: result.repositoryUrl,
    run: result.run,
  });
};

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Unknown GitHub App worker smoke failure.",
        },
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
});
