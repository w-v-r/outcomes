import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/console/page-header";
import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";
import { getConsoleTasks } from "@/lib/console/data";
import { formatCurrency } from "@/lib/console/format";

export const metadata: Metadata = {
  title: "Dashboard",
};

const ACTIVE_STATUSES = new Set([
  "approved",
  "charging",
  "executing",
  "starting",
  "verified",
  "verifying",
  "worker_succeeded",
]);
const FAILED_STATUSES = new Set([
  "failed",
  "payment_failed",
  "verification_failed",
  "worker_failed",
]);

const DashboardPage = async () => {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/sign-in");
  }

  const tasks = await getConsoleTasks(user.id);
  const completedTasks = tasks.filter((task) => task.status === "completed");
  const activeTasks = tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
  const failedTasks = tasks.filter((task) => FAILED_STATUSES.has(task.status));
  const terminalTaskCount = completedTasks.length + failedTasks.length;
  const completionRate =
    terminalTaskCount === 0
      ? 0
      : Math.round((completedTasks.length / terminalTaskCount) * 100);
  const totalPricedCents = tasks.reduce(
    (total, task) => total + (task.amountCents ?? 0),
    0,
  );

  const stageMetrics = [
    {
      label: "Quoted",
      value: tasks.filter((task) => task.status === "quoted").length,
    },
    { label: "Active", value: activeTasks.length },
    { label: "Completed", value: completedTasks.length },
    { label: "Failed", value: failedTasks.length },
  ];

  return (
    <>
      <PageHeader description="A summary of priced work." title="Dashboard" />

      <div className="max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <section
          aria-label="Task summary"
          className="grid border-y border-paper/10 sm:grid-cols-3 sm:divide-x sm:divide-paper/10"
        >
          <div className="border-b border-paper/10 py-6 sm:border-b-0 sm:pr-6">
            <p className="text-xs text-paper/45">Total priced</p>
            <p className="mt-2 font-mono text-3xl tracking-[-0.05em] text-paper">
              {formatCurrency(totalPricedCents)}
            </p>
          </div>
          <div className="border-b border-paper/10 py-6 sm:border-b-0 sm:px-6">
            <p className="text-xs text-paper/45">Tasks</p>
            <p className="mt-2 font-mono text-3xl tracking-[-0.05em] text-paper">
              {tasks.length}
            </p>
          </div>
          <div className="py-6 sm:pl-6">
            <p className="text-xs text-paper/45">Completion rate</p>
            <p className="mt-2 font-mono text-3xl tracking-[-0.05em] text-paper">
              {completionRate}%
            </p>
          </div>
        </section>

        <section aria-labelledby="pipeline-heading" className="mt-10">
          <div className="flex items-center justify-between">
            <h2
              className="text-xs font-medium uppercase tracking-[0.08em] text-paper/40"
              id="pipeline-heading"
            >
              Pipeline
            </h2>
            <span className="flex items-center gap-2 text-[11px] text-paper/40">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-cobalt"
              />
              Live
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 border-y border-paper/10 sm:grid-cols-4 sm:divide-x sm:divide-paper/10">
            {stageMetrics.map((metric, index) => {
              const borderClasses =
                index < 2
                  ? "border-b border-paper/10 sm:border-b-0"
                  : "";
              const spacingClasses =
                index === 0
                  ? "sm:pr-5"
                  : index === stageMetrics.length - 1
                    ? "sm:pl-5"
                    : "sm:px-5";

              return (
                <div
                  className={`py-5 ${borderClasses} ${spacingClasses}`}
                  key={metric.label}
                >
                  <p className="text-xs text-paper/45">{metric.label}</p>
                  <p className="mt-2 font-mono text-2xl tracking-[-0.04em] text-paper">
                    {metric.value}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
};

export default DashboardPage;
