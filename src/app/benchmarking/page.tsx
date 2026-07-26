import type { Metadata } from "next";

import { MarketingPageShell } from "@/components/marketing-page-shell";

export const metadata: Metadata = {
  title: "Benchmarking — Outcomes",
  description:
    "See how Outcomes pricing estimates compare with actual agent execution costs.",
};

const BenchmarkingPage = () => {
  return (
    <MarketingPageShell eyebrow="Pricing model / evidence" title="Benchmarking">
      <p className="text-xl leading-relaxed tracking-[-0.025em] text-muted sm:text-2xl">
        This page will demonstrate how Outcomes pricing estimates perform
        against actual execution costs.
      </p>
    </MarketingPageShell>
  );
};

export default BenchmarkingPage;
