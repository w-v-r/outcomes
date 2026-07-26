import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export const appendTaskEvent = async ({
  data = {},
  eventType,
  taskId,
  userId,
}: {
  data?: Record<string, unknown>;
  eventType: string;
  taskId: string;
  userId: string;
}) => {
  const supabase = createAdminClient();

  if (!supabase) {
    throw new Error("The control plane is not configured.");
  }

  const { error } = await supabase.from("task_events").insert({
    event_data: data,
    event_type: eventType,
    task_id: taskId,
    user_id: userId,
  });

  if (error) {
    throw new Error("The task event could not be recorded.", {
      cause: error,
    });
  }
};
