import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

import { accrueVerifiedTask } from "@/lib/billing/accrue-verified-task";
import { CHARGE_THRESHOLD_CENTS } from "@/lib/billing/threshold";
import { GET as settleBilling } from "@/app/api/internal/billing/settle/route";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260731035108_billing_accrual_threshold.sql",
);
const hardeningMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260731041830_harden_accrual_settlement.sql",
);
const statusLockMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260731042334_lock_successful_payment_status.sql",
);

beforeEach(() => {
  rpc.mockReset();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("$10 billing accrual policy", () => {
  test("uses a 1000 cent settlement threshold", () => {
    expect(CHARGE_THRESHOLD_CENTS).toBe(1_000);
  });

  test("maps an atomic database accrual result", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          accrual_id: "accrual-1",
          amount_cents: 1_250,
          currency: "AUD",
          payment_id: null,
          replayed: false,
          status: "accrued",
          user_id: "user-1",
        },
      ],
      error: null,
    });

    await expect(accrueVerifiedTask("task-1")).resolves.toEqual({
      accrualId: "accrual-1",
      amountCents: 1_250,
      currency: "AUD",
      paymentId: null,
      replayed: false,
      status: "accrued",
      userId: "user-1",
    });
    expect(rpc).toHaveBeenCalledWith("accrue_verified_task", {
      p_task_id: "task-1",
    });
  });

  test("keeps the settlement route protected by CRON_SECRET", async () => {
    process.env.CRON_SECRET = "settlement-secret";

    const response = await settleBilling(
      new Request("https://example.com/api/internal/billing/settle"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "unauthorized",
        message: "The internal billing trigger is unauthorized.",
      },
    });
  });

  test("registers a separate four-times-daily settlement cron", async () => {
    const config = JSON.parse(
      await readFile(path.join(process.cwd(), "vercel.json"), "utf8"),
    ) as {
      crons: Array<{ path: string; schedule: string }>;
    };

    expect(config.crons).toContainEqual({
      path: "/api/internal/billing/settle",
      schedule: "0 0,6,12,18 * * *",
    });
    expect(config.crons).toContainEqual({
      path: "/api/internal/task-executions/reconcile",
      schedule: "* * * * *",
    });
  });

  test("locks and allocates exact accrual rows atomically", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const hardeningMigration = await readFile(
      hardeningMigrationPath,
      "utf8",
    );
    const statusLockMigration = await readFile(
      statusLockMigrationPath,
      "utf8",
    );

    expect(migration).toContain("for update");
    expect(migration).toContain(
      "where accrual.id = any(selected_accrual_ids)",
    );
    expect(migration).toContain(
      "payment_allocations_active_task_idx",
    );
    expect(migration).toContain(
      "status in ('active', 'released')",
    );
    expect(migration).toContain(
      "create trigger payments_sync_billing_accruals",
    );
    expect(hardeningMigration).toContain(
      "create trigger payments_prevent_settled_regression",
    );
    expect(hardeningMigration).toContain(
      "create trigger payments_prevent_legacy_task_insert",
    );
    expect(hardeningMigration).toContain(
      "having pg_catalog.sum(accrual.amount_cents) >= p_threshold_cents",
    );
    expect(statusLockMigration).toContain(
      "old.status in ('approved', 'pending', 'settled')",
    );
  });
});
