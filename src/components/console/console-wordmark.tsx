import Link from "next/link";

type ConsoleWordmarkProps = {
  compact?: boolean;
};

export const ConsoleWordmark = ({
  compact = false,
}: ConsoleWordmarkProps) => {
  return (
    <Link
      aria-label="Outcomes home"
      className="group inline-flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-paper focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
      href="/"
    >
      <span className="grid size-7 place-items-center border border-paper/45 bg-paper text-ink transition-colors group-hover:border-cobalt group-hover:bg-cobalt group-hover:text-white">
        O
      </span>
      <span>{compact ? "Outcomes" : "Outcomes / Console"}</span>
    </Link>
  );
};
