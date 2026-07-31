import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { reconcileTaskExecutions } from "./task-execution";
import { reconcileTaskLifecycle } from "./tasks";

type DownstreamTask = {
  id: string;
  userId: string;
};

export const shouldReconcileCloudTask = (task: {
  repositoryBindingId: string | null;
  status: string;
  workerRuntime: string | null;
}): boolean =>
  task.workerRuntime === "cloud" &&
  (["starting", "executing"].includes(task.status) ||
    (task.status === "approved" && task.repositoryBindingId === null));

type ReconciliationDependencies = {
  executeTasks: typeof reconcileTaskExecutions;
  listDownstreamTasks: (batchSize: number) => Promise<DownstreamTask[]>;
  reconcileLifecycle: (task: DownstreamTask) => Promise<void>;
};

const createReconciliationDependencies = (): ReconciliationDependencies => ({
  executeTasks: reconcileTaskExecutions,
  listDownstreamTasks: async (batchSize) => {
    const admin = createAdminClient();

    if (!admin) {
      throw new Error("Control-plane reconciliation is not configured.");
    }

    const [
      { data: downstreamData, error: downstreamError },
      { data: cloudData, error: cloudError },
    ] = await Promise.all([
      admin
        .from("tasks")
        .select("id, user_id, updated_at")
        .in("status", [
          "worker_succeeded",
          "verifying",
          "verified",
        ])
        .order("updated_at", { ascending: true })
        .limit(batchSize),
      admin
        .from("tasks")
        .select(
          "id, user_id, updated_at, repository_binding_id, worker_runtime, status",
        )
        .eq("worker_runtime", "cloud")
        .in("status", ["approved", "starting", "executing"])
        .order("updated_at", { ascending: true })
        .limit(batchSize * 2),
    ]);

    if (
      downstreamError ||
      cloudError
    ) {
      throw new Error("Downstream task reconciliation could not be loaded.", {
        cause:
          downstreamError ?? cloudError,
      });
    }

    return [
      ...(cloudData ?? []).filter((task) =>
        shouldReconcileCloudTask({
          repositoryBindingId: task.repository_binding_id,
          status: task.status,
          workerRuntime: task.worker_runtime,
        }),
      ),
      ...(downstreamData ?? []),
    ]
      .sort((left, right) =>
        left.updated_at.localeCompare(right.updated_at),
      )
      .slice(0, batchSize)
      .map((task) => ({
        id: task.id,
        userId: task.user_id,
      }));
  },
  reconcileLifecycle: async (task) => {
    await reconcileTaskLifecycle(
      {
        apiKeyId: "internal-reconciler",
        userId: task.userId,
      },
      task.id,
    );
  },
});

export const createControlPlaneReconciler = (
  dependencies: ReconciliationDependencies,
) => {
  return async ({
    batchSize,
    claimedBy,
  }: {
    batchSize: number;
    claimedBy: string;
  }) => {
    const execution = await dependencies.executeTasks({
      batchSize,
      claimedBy,
    });
    const downstreamTasks =
      await dependencies.listDownstreamTasks(batchSize);
    const downstream = [];

    for (const task of downstreamTasks) {
      try {
        await dependencies.reconcileLifecycle(task);
        downstream.push({ status: "reconciled", taskId: task.id });
      } catch {
        downstream.push({ status: "failed", taskId: task.id });
      }
    }

    return {
      downstream,
      execution,
      partial: downstream.some(({ status }) => status === "failed"),
    };
  };
};

export const reconcileControlPlane = createControlPlaneReconciler(
  createReconciliationDependencies(),
);
