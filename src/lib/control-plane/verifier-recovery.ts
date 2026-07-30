import {
  type StartedVerification,
  type VerifierAdapter,
} from "@/lib/verifiers/types";

export type VerifierDispatchRecoveryTask = {
  id: string;
  leaseExpiresAt: string;
  userId: string;
  verifyingAt: string;
};

export type VerifierDispatchRecoveryStore = {
  failUnrecoverable: (
    task: VerifierDispatchRecoveryTask,
    reason: string,
  ) => Promise<boolean>;
  saveRecovered: (
    task: VerifierDispatchRecoveryTask,
    run: StartedVerification,
  ) => Promise<boolean>;
};

export const reconcileVerifierDispatchRecovery = async ({
  appendEvent,
  now = () => Date.now(),
  store,
  task,
  verifier,
}: {
  appendEvent: (
    type: "verifier.dispatch_unrecoverable" | "verifier.start_recovered",
    data: Record<string, unknown>,
  ) => Promise<void>;
  now?: () => number;
  store: VerifierDispatchRecoveryStore;
  task: VerifierDispatchRecoveryTask;
  verifier: VerifierAdapter;
}): Promise<"failed" | "lost_race" | "recovered" | "waiting"> => {
  const recovered = verifier.recoverVerification
    ? await verifier.recoverVerification({
        dispatchedAfter: task.verifyingAt,
        taskId: task.id,
      })
    : null;

  if (recovered) {
    const won = await store.saveRecovered(task, recovered);

    if (!won) {
      return "lost_race";
    }

    await appendEvent("verifier.start_recovered", {
      run_id: recovered.runId,
      url: recovered.url,
    });
    return "recovered";
  }

  if (new Date(task.leaseExpiresAt).getTime() > now()) {
    return "waiting";
  }

  const reason =
    "Trusted verification was dispatched but its provider run identity could not be established.";
  const won = await store.failUnrecoverable(task, reason);

  if (!won) {
    return "lost_race";
  }

  await appendEvent("verifier.dispatch_unrecoverable", { reason });
  return "failed";
};
