const STATUS_LABELS: Record<string, string> = {
  approved: "Approved",
  cancelled: "Cancelled",
  charging: "Charging",
  completed: "Completed",
  executing: "In progress",
  failed: "Failed",
  payment_failed: "Payment failed",
  quoted: "Quoted",
  starting: "Starting",
  verified: "Verified",
  verification_failed: "Verification failed",
  verifying: "Verifying",
  worker_failed: "Worker failed",
  worker_succeeded: "Worker complete",
};

export const formatCurrency = (
  amountCents: number,
  currency = "AUD",
) => {
  return new Intl.NumberFormat("en-AU", {
    currency,
    style: "currency",
  }).format(amountCents / 100);
};

export const formatConsoleDate = (value: string | null) => {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
};

export const formatStatus = (status: string) => {
  return (
    STATUS_LABELS[status] ??
    status
      .split("_")
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ")
  );
};

export const getStatusTone = (status: string) => {
  if (["completed", "settled", "approved", "ready"].includes(status)) {
    return "success";
  }

  if (
    [
      "cancelled",
      "disabled",
      "failed",
      "payment_failed",
      "verification_failed",
      "worker_failed",
    ].includes(status)
  ) {
    return "danger";
  }

  if (
    ["executing", "starting", "verifying", "charging", "pending"].includes(
      status,
    )
  ) {
    return "active";
  }

  return "neutral";
};
