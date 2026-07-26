import { describe, expect, test } from "vitest";

import { calculateUsageCostUsd } from "@/lib/pricing/rate-card";
import { decideTaskEligibility } from "@/lib/pricing/eligibility";
import { estimateTaskCost } from "@/lib/pricing/estimator";
import {
  FIXTURE_MANIFEST,
  FIXTURE_REPOSITORY,
  ZERO_DIVISION_TASK_CONTRACT,
  normalizeGitHubRepositoryUrl,
} from "@/lib/pricing/registry";
import { analyzeTask } from "@/lib/pricing/task-analysis";
import { deriveQuote } from "@/lib/pricing/quote-policy";

describe("pricing kernel", () => {
  test("normalizes supported GitHub URL forms", () => {
    expect(
      normalizeGitHubRepositoryUrl(
        "git@github.com:w-v-r/agent-cost-benchmark-fixture.git",
      ),
    ).toBe(FIXTURE_REPOSITORY.url);
    expect(
      normalizeGitHubRepositoryUrl(
        `${FIXTURE_REPOSITORY.url}/tree/main`,
      ),
    ).toBe(FIXTURE_REPOSITORY.url);
    expect(normalizeGitHubRepositoryUrl("https://example.com/repo")).toBeNull();
  });

  test("accepts only the pinned repository and bounded contract", () => {
    expect(
      decideTaskEligibility({
        repositorySha: FIXTURE_REPOSITORY.baselineSha,
        repositoryUrl: FIXTURE_REPOSITORY.url,
        task: ZERO_DIVISION_TASK_CONTRACT,
      }),
    ).toMatchObject({ code: "eligible", eligible: true });

    expect(
      decideTaskEligibility({
        repositorySha: "a".repeat(40),
        repositoryUrl: FIXTURE_REPOSITORY.url,
        task: ZERO_DIVISION_TASK_CONTRACT,
      }),
    ).toMatchObject({
      code: "repository_sha_not_allowed",
      eligible: false,
    });
  });

  test("rejects contradictory and revenue-guarantee requests", () => {
    expect(
      decideTaskEligibility({
        repositorySha: FIXTURE_REPOSITORY.baselineSha,
        repositoryUrl: FIXTURE_REPOSITORY.url,
        task: {
          ...ZERO_DIVISION_TASK_CONTRACT,
          acceptanceCriteria: [
            "The same call returns zero and throws an Error.",
          ],
        },
      }),
    ).toMatchObject({ code: "contradictory_task", eligible: false });

    expect(
      decideTaskEligibility({
        repositorySha: FIXTURE_REPOSITORY.baselineSha,
        repositoryUrl: FIXTURE_REPOSITORY.url,
        task: {
          ...ZERO_DIVISION_TASK_CONTRACT,
          description: "Guarantee revenue by fixing the calculator.",
        },
      }),
    ).toMatchObject({
      code: "revenue_guarantee_not_allowed",
      eligible: false,
    });
  });

  test("estimates the fixture and applies the AUD 12.50 floor", async () => {
    const task = {
      id: "test-task",
      ...ZERO_DIVISION_TASK_CONTRACT,
    };
    const analysis = analyzeTask(task, FIXTURE_MANIFEST);
    const estimate = await estimateTaskCost({
      analysis,
      manifest: FIXTURE_MANIFEST,
      modelRate: {
        cacheReadPerMillionUsd: 0.2,
        cacheWritePerMillionUsd: 0,
        effectiveDate: "2026-07-25",
        id: "composer-2.5",
        inputPerMillionUsd: 0.5,
        label: "Composer",
        modelParams: [],
        outputPerMillionUsd: 2.5,
        source: "test",
      },
      task,
    });
    const quote = deriveQuote({
      analysis,
      estimate,
      now: new Date("2026-07-26T00:00:00.000Z"),
      repositorySha: FIXTURE_REPOSITORY.baselineSha,
      repositoryUrl: FIXTURE_REPOSITORY.url,
      task: ZERO_DIVISION_TASK_CONTRACT,
    });

    expect(analysis.likelyRelevantFiles[0]?.path).toContain("calculator");
    expect(estimate.executionAllowance.softTokenLimit).toBeGreaterThan(
      estimate.predicted.inputTokens.central,
    );
    expect(quote.amountCents).toBe(1_250);
    expect(quote.contractHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("calculates categorized cost from the versioned rate", () => {
    expect(
      calculateUsageCostUsd({
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(3.2);
  });
});
