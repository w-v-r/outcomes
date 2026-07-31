import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/console/page-header";
import { StatusBadge } from "@/components/console/status-badge";
import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";
import { getConsoleTasks } from "@/lib/console/data";
import {
  formatConsoleDate,
  formatCurrency,
} from "@/lib/console/format";

export const metadata: Metadata = {
  title: "Tasks",
};

const TasksPage = async () => {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/sign-in");
  }

  const tasks = await getConsoleTasks(user.id);

  return (
    <>
      <PageHeader
        description="Fixed-price work and its current state."
        title="Tasks"
      />

      <div className="px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <div className="overflow-x-auto border-y border-paper/10">
          <table className="w-full min-w-[840px] border-collapse text-left">
            <thead>
              <tr className="border-b border-paper/10 text-[11px] font-medium uppercase tracking-[0.07em] text-paper/40">
                <th className="px-3 py-3 font-medium" scope="col">
                  Task
                </th>
                <th className="px-3 py-3 font-medium" scope="col">
                  Price
                </th>
                <th className="px-3 py-3 font-medium" scope="col">
                  Status
                </th>
                <th className="px-3 py-3 font-medium" scope="col">
                  Billing
                </th>
                <th className="px-3 py-3 font-medium" scope="col">
                  Created
                </th>
                <th className="px-3 py-3 text-right font-medium" scope="col">
                  Result
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper/10">
              {tasks.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-12 text-center text-sm text-paper/45"
                    colSpan={6}
                  >
                    No priced tasks yet.
                  </td>
                </tr>
              ) : (
                tasks.map((task) => (
                  <tr className="text-sm" key={task.id}>
                    <th className="max-w-md px-3 py-4 font-normal" scope="row">
                      <p className="font-medium text-paper">{task.title}</p>
                      <p className="mt-1 font-mono text-[10px] text-paper/35">
                        {task.id.slice(0, 8)}
                      </p>
                    </th>
                    <td className="whitespace-nowrap px-3 py-4 font-mono text-xs text-paper">
                      {task.amountCents === null
                        ? "—"
                        : formatCurrency(task.amountCents, task.currency)}
                    </td>
                    <td className="px-3 py-4">
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="px-3 py-4">
                      {task.settlementStatus ? (
                        <StatusBadge status={task.settlementStatus} />
                      ) : (
                        <span className="text-xs text-paper/25">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-paper/45">
                      {formatConsoleDate(task.createdAt)}
                    </td>
                    <td className="px-3 py-4 text-right">
                      {task.resultPrUrl ? (
                        <a
                          aria-label={`Open pull request for ${task.title}`}
                          className="text-xs font-medium text-paper underline decoration-paper/25 underline-offset-4 transition-colors hover:decoration-paper focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
                          href={task.resultPrUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          View PR
                        </a>
                      ) : (
                        <span className="text-paper/25">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

export default TasksPage;
