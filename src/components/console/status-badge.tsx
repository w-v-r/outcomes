import { formatStatus, getStatusTone } from "@/lib/console/format";

const STATUS_CLASSES = {
  active: "bg-cobalt/15 text-[#aeb7ff]",
  danger: "bg-coral/15 text-[#ff9e87]",
  neutral: "bg-paper/[0.07] text-paper/55",
  success: "bg-[#7fb596]/15 text-[#9bc8ad]",
};

type StatusBadgeProps = {
  status: string;
};

export const StatusBadge = ({ status }: StatusBadgeProps) => {
  const tone = getStatusTone(status);

  return (
    <span
      className={`inline-flex w-fit items-center rounded-md px-2 py-1 text-[11px] font-medium ${STATUS_CLASSES[tone]}`}
    >
      {formatStatus(status)}
    </span>
  );
};
