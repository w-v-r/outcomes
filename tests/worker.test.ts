import { describe, expect, test } from "vitest";

import { ZERO_DIVISION_TASK_CONTRACT } from "@/lib/pricing/registry";
import { buildWorkerPrompt } from "@/lib/workers/cursor/adapter";

describe("Cursor worker boundary", () => {
  test("constructs a bounded prompt without customer-controlled commands", () => {
    const prompt = buildWorkerPrompt(ZERO_DIVISION_TASK_CONTRACT);

    expect(prompt).toContain(ZERO_DIVISION_TASK_CONTRACT.description);
    expect(prompt).toContain("Do not modify tests");
    expect(prompt).toContain("Do not read docs/large-context.txt");
    expect(prompt).not.toContain("workflow_dispatch");
    expect(prompt).not.toContain("curl ");
  });
});
