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
  async startVerification({
    baselineSha,
    resultRef,
    taskId,
  }: {
    baselineSha: string;
    resultRef: string;
    taskId: string;
  }): Promise<StartedVerification> {
    const dispatchedAt = Date.now();

    await githubRequest(
      `/repos/${FIXTURE_REPOSITORY.fullName}/actions/workflows/${FIXTURE_REPOSITORY.verifierWorkflow}/dispatches`,
      {
        body: JSON.stringify({
          inputs: {
            baseline_sha: baselineSha,
            result_ref: resultRef,
            task_id: taskId,
          },
          ref: FIXTURE_REPOSITORY.defaultBranch,
        }),
        method: "POST",
      },
    );

    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) {
        await wait(500);
      }

      const response = await githubRequest(
        `/repos/${FIXTURE_REPOSITORY.fullName}/actions/workflows/${FIXTURE_REPOSITORY.verifierWorkflow}/runs?event=workflow_dispatch&per_page=10`,
      );
      const payload = (await response.json()) as {
        workflow_runs?: Array<{
          created_at: string;
          display_title: string;
          html_url: string;
          id: number;
        }>;
      };
      const matchingRun = payload.workflow_runs?.find((run) => {
        const createdAt = new Date(run.created_at).getTime();

        return (
          createdAt >= dispatchedAt - 2_000 &&
          run.display_title === `Verify Outcomes task ${taskId}`
        );
      });

      if (matchingRun) {
        return {
          runId: matchingRun.id,
          url: matchingRun.html_url,
        };
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
      `/repos/${FIXTURE_REPOSITORY.fullName}/actions/runs/${runId}`,
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
