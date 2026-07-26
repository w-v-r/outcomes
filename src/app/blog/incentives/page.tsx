import type { Metadata } from "next";

import { MarketingPageShell } from "@/components/marketing-page-shell";

export const metadata: Metadata = {
  title: "Incentives — Outcomes",
  description: "A note from Outcomes about incentives in agent work.",
};

const IncentivesPage = () => {
  return (
    <MarketingPageShell eyebrow="Outcomes / Notes" title="Incentives">
      <p className="font-serif text-3xl italic leading-tight tracking-[-0.03em] sm:text-5xl">
        Incentives, incentives, incentives.
      </p>
    </MarketingPageShell>
  );
};

export default IncentivesPage;
