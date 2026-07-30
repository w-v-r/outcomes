import "server-only";

import { FIXTURE_REPOSITORY } from "@/lib/pricing/registry";
import {
  type RefreshedVerification,
  type StartedVerification,
  type VerifierAdapter,
} from "@/lib/verifiers/types";

const GITHUB_API_URL = "https://api.github.com";

const requireGitHubToken = () => {
  const token = (
    process.env.OUTCOMES_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN
  )?.trim();

  if (!token) {
    throw new Error("OUTCOMES_GITHUB_TOKEN is not configured.");
  }

  return token;
};

const githubRequest = async (
  path: string,
  init: RequestInit = {},
) => {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${requireGitHubToken()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API request failed (${response.status}): ${body.slice(0, 300)}`,
    );
  }

  return response;
};

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class GitHubActionsVerifierAdapter implements VerifierAdapter {
  readonly #defaultBranch: string;
  readonly #repositoryFullName: string;
  readonly #verifierWorkflow: string;

  constructor({
    defaultBranch = FIXTURE_REPOSITORY.defaultBranch,
    repositoryFullName = FIXTURE_REPOSITORY.fullName,
    verifierWorkflow = FIXTURE_REPOSITORY.verifierWorkflow,
  }: {
    defaultBranch?: string;
    repositoryFullName?: string;
    verifierWorkflow?: string;
  } = {}) {
    this.#defaultBranch = defaultBranch;
    this.#repositoryFullName = repositoryFullName;
    this.#verifierWorkflow = verifierWorkflow;
  }

  async recoverVerification({
    dispatchedAfter,
    taskId,
  }: {
    dispatchedAfter: string;
    taskId: string;
  }): Promise<StartedVerification | null> {
    const response = await githubRequest(
      `/repos/${this.#repositoryFullName}/actions/workflows/${this.#verifierWorkflow}/runs?event=workflow_dispatch&per_page=100`,
    );
    const payload = (await response.json()) as {
      workflow_runs?: Array<{
        created_at: string;
        display_title: string;
        html_url: string;
        id: number;
      }>;
    };
    const dispatchedAt = new Date(dispatchedAfter).getTime();
    const matchingRuns = (payload.workflow_runs ?? []).filter((run) => {
      const createdAt = new Date(run.created_at).getTime();

      return (
        Number.isFinite(dispatchedAt) &&
        createdAt >= dispatchedAt - 2_000 &&
        run.display_title === `Verify Outcomes task ${taskId}`
      );
    });

    if (matchingRuns.length > 1) {
      throw new Error(
        "Multiple verifier runs match the deterministic task dispatch identity.",
      );
    }

    const matchingRun = matchingRuns[0];
    return matchingRun
      ? { runId: matchingRun.id, url: matchingRun.html_url }
      : null;
  }

  async startVerification({
    baselineSha,
    resultRef,
    taskId,
  }: {
    baselineSha: string;
    resultRef: string;
    taskId: string;
  }): Promise<StartedVerification> {
    const dispatchedAt = new Date().toISOString();

    await githubRequest(
      `/repos/${this.#repositoryFullName}/actions/workflows/${this.#verifierWorkflow}/dispatches`,
      {
        body: JSON.stringify({
          inputs: {
            baseline_sha: baselineSha,
            result_ref: resultRef,
            task_id: taskId,
          },
          ref: this.#defaultBranch,
        }),
        method: "POST",
      },
    );

    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) {
        await wait(500);
      }

      const matchingRun = await this.recoverVerification({
        dispatchedAfter: dispatchedAt,
        taskId,
      });

      if (matchingRun) {
        return matchingRun;
      }
    }

    throw new Error(
      "The verifier workflow was dispatched but its run ID was not found.",
    );
  }

  async refreshVerification(
    runId: number,
  ): Promise<RefreshedVerification> {
    const response = await githubRequest(
      `/repos/${this.#repositoryFullName}/actions/runs/${runId}`,
    );
    const run = (await response.json()) as {
      conclusion: string | null;
      html_url: string;
      status: "queued" | "in_progress" | "completed";
    };

    return {
      conclusion: run.conclusion,
      status: run.status,
      url: run.html_url,
    };
  }
}
