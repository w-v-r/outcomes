import { afterEach, describe, expect, test, vi } from "vitest";

import {
  classifyPinchPaymentStatus,
  isDefinitivePinchRejection,
  resolvePaymentOutcomeOrder,
  submitOrRecoverPinchPayment,
} from "@/lib/billing/charge-verified-task";
import { GitHubActionsVerifierAdapter } from "@/lib/verifiers/github/adapter";
import { PinchApiError, type PinchPayment } from "@/lib/pinch/client";
import { reconcileVerifierDispatchRecovery } from "@/lib/control-plane/verifier-recovery";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => null,
}));

const payment: PinchPayment = {
  amount: 1000,
  attemptId: "attempt-1",
  currency: "AUD",
  estimatedTransferDate: null,
  id: "payment-1",
  sourceType: "credit-card",
  status: "approved",
  transactionDate: "2026-07-31T00:00:00.000Z",
};

const paymentInput = {
  amountCents: 1000,
  description: "Outcomes test",
  metadata: { outcomesTaskId: "task-1" },
  nonce: "outcomes-task-task-1-charge-v1",
  payerId: "payer-1",
  sourceId: "source-1",
};

afterEach(() => {
  delete process.env.OUTCOMES_GITHUB_TOKEN;
  vi.restoreAllMocks();
});

describe("deterministic Pinch payment recovery", () => {
  test("preserves terminal success across overlapping ambiguous results", () => {
    expect(resolvePaymentOutcomeOrder("approved", "unknown")).toBe(
      "approved",
    );
    expect(
      resolvePaymentOutcomeOrder(
        resolvePaymentOutcomeOrder("submitting", "unknown"),
        "approved",
      ),
    ).toBe("approved");
  });

  test("keeps auth, conflict, throttling, and provider outages recoverable", () => {
    for (const status of [401, 403, 404, 409, 429, 500, 503]) {
      expect(
        isDefinitivePinchRejection(new PinchApiError("provider", status)),
      ).toBe(false);
    }

    expect(
      isDefinitivePinchRejection(new PinchApiError("invalid request", 400)),
    ).toBe(true);
    expect(
      isDefinitivePinchRejection(new PinchApiError("rejected", 422)),
    ).toBe(true);
  });

  test("does not convert unknown provider statuses into rejection", () => {
    expect(
      classifyPinchPaymentStatus({ ...payment, status: "processing" }),
    ).toBe("unknown");
    expect(
      classifyPinchPaymentStatus({
        ...payment,
        dishonour: { code: "declined" },
        status: "completed",
      }),
    ).toBe("failed");
  });

  test("reconciles a crash after submission without resubmitting", async () => {
    const createPayment = vi.fn(async () => payment);
    const lookupNonce = vi.fn(async () => ({
      data: payment,
      isNonceReplay: true,
      nonce: paymentInput.nonce,
    }));

    await expect(
      submitOrRecoverPinchPayment({
        createPayment,
        existingStatus: "submitting",
        input: paymentInput,
        lookupNonce,
      }),
    ).resolves.toEqual(payment);
    expect(createPayment).not.toHaveBeenCalled();
  });

  test("resubmits only with the same nonce after definitive no-replay evidence", async () => {
    const createPayment = vi.fn(async () => payment);

    await submitOrRecoverPinchPayment({
      createPayment,
      existingStatus: "reserved",
      input: paymentInput,
      lookupNonce: async () => ({
        data: null,
        isNonceReplay: false,
        nonce: paymentInput.nonce,
      }),
    });

    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: paymentInput.nonce }),
    );
  });

  test("recovers an ambiguous create response by nonce", async () => {
    const createError = new Error("connection reset");

    await expect(
      submitOrRecoverPinchPayment({
        createPayment: async () => {
          throw createError;
        },
        existingStatus: null,
        input: paymentInput,
        lookupNonce: async () => ({
          data: payment,
          isNonceReplay: true,
          nonce: paymentInput.nonce,
        }),
      }),
    ).resolves.toEqual(payment);
  });
});

describe("verifier dispatch transition races", () => {
  const recoveryTask = {
    id: "task-1",
    leaseExpiresAt: "2026-07-31T00:02:00.000Z",
    userId: "user-1",
    verifyingAt: "2026-07-31T00:00:00.000Z",
  };
  const recoveredRun = {
    runId: 77,
    url: "https://github.com/acme/repo/actions/runs/77",
  };

  test("does not emit recovered event when a concurrent transition won", async () => {
    const appendEvent = vi.fn(async () => undefined);

    await expect(
      reconcileVerifierDispatchRecovery({
        appendEvent,
        now: () => new Date("2026-07-31T00:01:00.000Z").getTime(),
        store: {
          failUnrecoverable: async () => false,
          saveRecovered: async () => false,
        },
        task: recoveryTask,
        verifier: {
          recoverVerification: async () => recoveredRun,
          refreshVerification: vi.fn(),
          startVerification: vi.fn(),
        },
      }),
    ).resolves.toBe("lost_race");
    expect(appendEvent).not.toHaveBeenCalled();
  });

  test("does not emit terminal event when stale recovery lost its race", async () => {
    const appendEvent = vi.fn(async () => undefined);

    await expect(
      reconcileVerifierDispatchRecovery({
        appendEvent,
        now: () => new Date("2026-07-31T00:03:00.000Z").getTime(),
        store: {
          failUnrecoverable: async () => false,
          saveRecovered: async () => false,
        },
        task: recoveryTask,
        verifier: {
          recoverVerification: async () => null,
          refreshVerification: vi.fn(),
          startVerification: vi.fn(),
        },
      }),
    ).resolves.toBe("lost_race");
    expect(appendEvent).not.toHaveBeenCalled();
  });

  test("emits exactly one event only after the conditional transition wins", async () => {
    const appendEvent = vi.fn(async () => undefined);

    await expect(
      reconcileVerifierDispatchRecovery({
        appendEvent,
        store: {
          failUnrecoverable: async () => false,
          saveRecovered: async () => true,
        },
        task: recoveryTask,
        verifier: {
          recoverVerification: async () => recoveredRun,
          refreshVerification: vi.fn(),
          startVerification: vi.fn(),
        },
      }),
    ).resolves.toBe("recovered");
    expect(appendEvent).toHaveBeenCalledTimes(1);
  });
});

describe("GitHub verifier dispatch recovery", () => {
  test("discovers the durable workflow identity after a dispatch crash", async () => {
    process.env.OUTCOMES_GITHUB_TOKEN = "github-test-token";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        workflow_runs: [
          {
            created_at: "2026-07-31T00:00:01.000Z",
            display_title: "Verify Outcomes task task-1",
            html_url: "https://github.com/acme/repo/actions/runs/77",
            id: 77,
          },
        ],
      }),
    );

    await expect(
      new GitHubActionsVerifierAdapter().recoverVerification({
        dispatchedAfter: "2026-07-31T00:00:00.000Z",
        taskId: "task-1",
      }),
    ).resolves.toEqual({
      runId: 77,
      url: "https://github.com/acme/repo/actions/runs/77",
    });
  });

  test("fails closed on ambiguous duplicate verifier runs", async () => {
    process.env.OUTCOMES_GITHUB_TOKEN = "github-test-token";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        workflow_runs: [77, 78].map((id) => ({
          created_at: "2026-07-31T00:00:01.000Z",
          display_title: "Verify Outcomes task task-1",
          html_url: `https://github.com/acme/repo/actions/runs/${id}`,
          id,
        })),
      }),
    );

    await expect(
      new GitHubActionsVerifierAdapter().recoverVerification({
        dispatchedAfter: "2026-07-31T00:00:00.000Z",
        taskId: "task-1",
      }),
    ).rejects.toThrow("Multiple verifier runs");
  });
});
