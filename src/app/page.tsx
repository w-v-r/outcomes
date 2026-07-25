import { QuoteVisual } from "@/components/quote-visual";

const ArrowUpRight = () => {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    >
      <path d="M4 12 12 4M5 4h7v7" />
    </svg>
  );
};

const Wordmark = () => {
  return (
    <a
      aria-label="Outcomes home"
      className="group inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.15em]"
      href="#top"
    >
      <span className="grid size-6 place-items-center border border-ink bg-ink text-paper transition-colors group-hover:bg-cobalt">
        O
      </span>
      Outcomes
    </a>
  );
};

const SectionLabel = ({ children }: Readonly<{ children: React.ReactNode }>) => {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
      {children}
    </p>
  );
};

const Header = () => {
  return (
    <header className="border-b border-ink/15">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
        <Wordmark />
        <nav aria-label="Primary navigation" className="flex items-center gap-7">
          <a
            className="hidden text-sm text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt sm:block"
            href="#how-it-works"
          >
            How it works
          </a>
          <a
            className="hidden text-sm text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt md:block"
            href="#economics"
          >
            Economics
          </a>
          <a
            className="inline-flex items-center gap-2 border border-ink bg-ink px-4 py-2.5 text-xs font-medium text-paper transition-colors hover:border-cobalt hover:bg-cobalt focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
            href="#early-access"
          >
            Request access
            <ArrowUpRight />
          </a>
        </nav>
      </div>
    </header>
  );
};

const Hero = () => {
  return (
    <section className="mx-auto max-w-[1440px] px-5 pt-16 sm:px-8 sm:pt-24 lg:px-12 lg:pt-28">
      <div className="grid gap-8 lg:grid-cols-[1fr_320px] lg:items-end">
        <div>
          <SectionLabel>Agent work / priced upfront</SectionLabel>
          <h1 className="mt-6 max-w-5xl text-[clamp(3.15rem,8vw,8.2rem)] font-medium leading-[0.86] tracking-[-0.07em]">
            Know the price
            <br />
            <span className="font-serif font-normal italic tracking-[-0.055em]">
              before
            </span>{" "}
            the agent starts.
          </h1>
        </div>
        <div className="border-l border-ink/20 pl-5 lg:mb-2">
          <p className="text-lg leading-snug tracking-[-0.02em]">
            Predictable prices for agent work. One task, one quote—regardless
            of how many tokens it takes.
          </p>
          <a
            className="mt-6 inline-flex items-center gap-2 border-b border-ink pb-1 text-sm font-medium transition-colors hover:border-cobalt hover:text-cobalt focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
            href="#how-it-works"
          >
            See the mechanism
            <span aria-hidden="true">↓</span>
          </a>
        </div>
      </div>

      <div className="mt-12 sm:mt-16">
        <div className="flex items-center justify-between border border-ink/15 px-4 py-3 font-mono text-[9px] uppercase tracking-[0.16em] text-muted sm:px-5">
          <span>Task price / fixed</span>
          <span className="hidden sm:inline">Execution / optimised</span>
          <span>Payment / on proof</span>
        </div>
        <QuoteVisual />
      </div>
    </section>
  );
};

const ProblemSection = () => {
  return (
    <section className="mx-auto max-w-[1440px] px-5 py-28 sm:px-8 sm:py-40 lg:px-12">
      <div className="grid gap-14 lg:grid-cols-2 lg:gap-24">
        <div>
          <SectionLabel>The mispriced unit</SectionLabel>
          <h2 className="mt-6 max-w-xl text-5xl font-medium leading-[0.94] tracking-[-0.055em] sm:text-7xl">
            You want the work.
            <br />
            <span className="font-serif font-normal italic text-muted">
              Not the meter.
            </span>
          </h2>
        </div>
        <div className="flex items-end">
          <p className="max-w-xl text-xl leading-[1.45] tracking-[-0.025em] text-muted sm:text-2xl">
            Token pricing makes you absorb every loop, retry, and expensive
            route. We move that uncertainty to the provider—where it can
            actually be managed.
          </p>
        </div>
      </div>

      <div className="mt-16 grid border-y border-ink lg:grid-cols-2">
        <article className="border-b border-ink px-0 py-8 lg:border-b-0 lg:border-r lg:pr-10">
          <div className="flex items-center justify-between">
            <SectionLabel>Token pricing</SectionLabel>
            <span className="size-2.5 rounded-full bg-coral" />
          </div>
          <div className="mt-16 flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                Final cost
              </p>
              <p className="mt-3 font-mono text-6xl tracking-[-0.07em] sm:text-8xl">
                $?
              </p>
            </div>
            <svg
              aria-label="An unpredictable rising cost line"
              className="h-24 w-1/2 text-coral"
              viewBox="0 0 280 100"
              fill="none"
            >
              <path
                d="M2 84c31 0 28-17 52-17 27 0 24 14 48 14 31 0 25-56 56-56 21 0 17 35 40 35 28 0 30-58 80-58"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M2 98h276"
                stroke="currentColor"
                strokeDasharray="3 4"
                strokeOpacity=".35"
              />
            </svg>
          </div>
          <p className="mt-10 max-w-sm text-sm leading-relaxed text-muted">
            More consumption means more revenue—even when the extra
            consumption does not improve the result.
          </p>
        </article>

        <article className="bg-cobalt px-6 py-8 text-white sm:px-10">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/65">
              Task pricing
            </p>
            <span className="size-2.5 rounded-full bg-white" />
          </div>
          <div className="mt-16 flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/65">
                Fixed before work
              </p>
              <p className="mt-3 font-mono text-6xl tracking-[-0.07em] sm:text-8xl">
                $28
              </p>
            </div>
            <div className="mb-3 grid size-20 place-items-center rounded-full border border-white/50 font-mono text-[10px] uppercase tracking-[0.12em]">
              Locked
            </div>
          </div>
          <p className="mt-10 max-w-sm text-sm leading-relaxed text-white/70">
            We earn more by completing the work reliably and efficiently—not
            by making the meter run.
          </p>
        </article>
      </div>
    </section>
  );
};

const steps = [
  {
    number: "01",
    title: "Define the work",
    body: "Describe a bounded coding task and the evidence that will prove it is complete.",
    meta: "Scope + acceptance criteria",
  },
  {
    number: "02",
    title: "Lock the price",
    body: "See one task price before execution. If the risk cannot be priced responsibly, we decline or quote discovery.",
    meta: "Fixed quote + terms",
  },
  {
    number: "03",
    title: "Settle on proof",
    body: "The agent executes against the contract. Verification controls whether the work settles.",
    meta: "Evidence + settlement",
  },
] as const;

const HowItWorks = () => {
  return (
    <section
      className="border-y border-ink bg-ink text-paper"
      id="how-it-works"
    >
      <div className="mx-auto max-w-[1440px] px-5 py-24 sm:px-8 sm:py-32 lg:px-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/50">
              The contract loop
            </p>
            <h2 className="mt-6 text-5xl font-medium leading-[0.95] tracking-[-0.055em] sm:text-7xl">
              Three steps.
              <br />
              <span className="font-serif font-normal italic text-paper/50">
                One known price.
              </span>
            </h2>
          </div>
          <p className="max-w-lg text-lg leading-relaxed text-paper/60 lg:justify-self-end">
            The quote is an agreement about the result—not an estimate of how
            long the meter might run.
          </p>
        </div>

        <div className="mt-20 grid border-t border-paper/20 lg:grid-cols-3">
          {steps.map((step) => (
            <article
              className="border-b border-paper/20 py-8 lg:border-b-0 lg:border-r lg:px-8 lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0"
              key={step.number}
            >
              <p className="font-mono text-xs text-coral">{step.number}</p>
              <h3 className="mt-12 text-3xl font-medium tracking-[-0.04em]">
                {step.title}
              </h3>
              <p className="mt-5 max-w-sm leading-relaxed text-paper/60">
                {step.body}
              </p>
              <p className="mt-12 border-t border-paper/20 pt-4 font-mono text-[9px] uppercase tracking-[0.15em] text-paper/40">
                Output / {step.meta}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

const Economics = () => {
  return (
    <section
      className="mx-auto max-w-[1440px] px-5 py-28 sm:px-8 sm:py-40 lg:px-12"
      id="economics"
    >
      <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24">
        <div>
          <SectionLabel>Aligned economics</SectionLabel>
          <h2 className="mt-6 text-5xl font-medium leading-[0.96] tracking-[-0.055em] sm:text-7xl">
            Efficiency is
            <br />
            <span className="font-serif font-normal italic text-cobalt">
              the margin.
            </span>
          </h2>
          <p className="mt-8 max-w-md text-lg leading-relaxed text-muted">
            Charge less than the work is worth. Deliver it for less than you
            charge. The spread rewards better pricing, routing, and execution.
          </p>
        </div>

        <div className="border-t border-ink">
          <div className="grid grid-cols-[1fr_auto] items-center border-b border-ink/20 py-6">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
                Customer&apos;s alternative cost
              </p>
              <div className="mt-3 h-3 w-full bg-ledger">
                <div className="h-full w-full bg-ink" />
              </div>
            </div>
            <p className="ml-8 font-mono text-2xl">$120.00</p>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-center border-b border-ink/20 py-6">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
                Fixed customer price
              </p>
              <div className="mt-3 h-3 w-full bg-ledger">
                <div className="h-full w-[23%] bg-cobalt" />
              </div>
            </div>
            <p className="ml-8 font-mono text-2xl text-cobalt">$28.00</p>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-center border-b border-ink/20 py-6">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
                Execution + payment cost
              </p>
              <div className="mt-3 h-3 w-full bg-ledger">
                <div className="h-full w-[8%] bg-coral" />
              </div>
            </div>
            <p className="ml-8 font-mono text-2xl">$9.42</p>
          </div>
          <div className="flex items-end justify-between bg-cobalt-light px-5 py-6">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
                Gross profit
              </p>
              <p className="mt-2 text-sm text-muted">
                Fixed price − delivery cost
              </p>
            </div>
            <p className="font-mono text-3xl text-cobalt">$18.58</p>
          </div>
          <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
            Illustrative economics only
          </p>
        </div>
      </div>
    </section>
  );
};

const Vision = () => {
  return (
    <section className="border-y border-ink bg-[#dedfd8]">
      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-2">
        <div className="px-5 py-24 sm:px-8 sm:py-32 lg:border-r lg:border-ink lg:px-12">
          <SectionLabel>The compounding edge</SectionLabel>
          <p className="mt-8 max-w-xl text-3xl leading-[1.12] tracking-[-0.04em] sm:text-5xl">
            Every quote teaches the system what work costs, which routes
            succeed, and when to say{" "}
            <span className="font-serif italic text-cobalt">no.</span>
          </p>
        </div>
        <div className="border-t border-ink px-5 py-24 sm:px-8 sm:py-32 lg:border-t-0 lg:px-12">
          <SectionLabel>From metering to underwriting</SectionLabel>
          <div className="mt-8 space-y-0">
            {[
              "Budgetable engineering tasks",
              "Cost-optimised model routing",
              "Verified outcome contracts",
              "A market priced in work",
            ].map((item, index) => (
              <div
                className="flex items-center justify-between border-t border-ink/30 py-5 last:border-b"
                key={item}
              >
                <p className="text-lg tracking-[-0.02em]">{item}</p>
                <span className="font-mono text-[10px] text-muted">
                  0{index + 1}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

const FinalCta = () => {
  return (
    <section
      className="mx-auto max-w-[1440px] px-5 py-28 sm:px-8 sm:py-40 lg:px-12"
      id="early-access"
    >
      <div className="relative overflow-hidden border border-ink bg-cobalt px-6 py-16 text-white sm:px-10 sm:py-24 lg:px-16">
        <svg
          aria-hidden="true"
          className="absolute -right-16 -top-24 h-[430px] w-[430px] text-white/15"
          viewBox="0 0 430 430"
          fill="none"
        >
          <circle cx="215" cy="215" r="120" stroke="currentColor" />
          <circle cx="215" cy="215" r="160" stroke="currentColor" />
          <circle cx="215" cy="215" r="200" stroke="currentColor" />
          <path d="M15 215h400M215 15v400" stroke="currentColor" />
        </svg>
        <div className="relative max-w-4xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/60">
            Early access / limited pilot
          </p>
          <h2 className="mt-7 text-5xl font-medium leading-[0.92] tracking-[-0.06em] sm:text-7xl lg:text-8xl">
            Price the task.
            <br />
            <span className="font-serif font-normal italic text-white/65">
              Not the tokens.
            </span>
          </h2>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-white/70">
            We&apos;re starting with bounded, testable coding tasks for teams
            already using agents.
          </p>
          <a
            className="mt-10 inline-flex items-center gap-3 border border-white bg-white px-6 py-4 text-sm font-medium text-cobalt transition-colors hover:bg-transparent hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            href="mailto:?subject=Outcomes%20early%20access&body=I%27d%20like%20to%20request%20early%20access%20to%20Outcomes."
          >
            Request early access
            <ArrowUpRight />
          </a>
        </div>
      </div>
    </section>
  );
};

const PilotPanel = () => {
  return (
    <section className="mx-auto max-w-[1440px] px-5 pb-20 sm:px-8 sm:pb-28 lg:px-12">
      <div className="relative min-h-[430px] overflow-hidden rounded-[2rem] bg-[#b3f83f] px-6 py-16 sm:min-h-[500px] sm:px-10 sm:py-24 lg:px-16">
        <div
          aria-hidden="true"
          className="absolute -right-[8%] -top-[35%] size-[600px] rounded-full bg-[#efffc8]/80 blur-3xl"
        />
        <div className="relative flex min-h-[302px] flex-col justify-center sm:min-h-[308px]">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/55 sm:text-xs">
            A new unit for AI work
          </p>
          <h2 className="mt-7 max-w-5xl text-5xl font-medium leading-[0.94] tracking-[-0.06em] sm:text-7xl lg:text-[6.5rem]">
            Put a price on the task.
          </h2>
          <a
            className="mt-12 inline-flex w-fit items-center gap-8 rounded-full bg-ink px-8 py-5 text-base font-medium text-paper transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
            href="mailto:?subject=Outcomes%20pilot&body=I%27d%20like%20to%20join%20the%20Outcomes%20pilot."
          >
            Join the pilot
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </section>
  );
};

const Footer = () => {
  return (
    <footer className="border-t border-ink/15">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <Wordmark />
        <p className="max-w-md font-mono text-[9px] uppercase leading-relaxed tracking-[0.14em] text-muted">
          Cursor does the work. We price and verify the outcome.
        </p>
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
          Sydney / 2026
        </p>
      </div>
    </footer>
  );
};

const Home = () => {
  return (
    <main id="top">
      <a
        className="fixed left-3 top-3 z-50 -translate-y-20 bg-ink px-4 py-3 text-sm text-white transition-transform focus:translate-y-0"
        href="#main-content"
      >
        Skip to content
      </a>
      <Header />
      <div id="main-content">
        <Hero />
        <ProblemSection />
        <HowItWorks />
        <Economics />
        <Vision />
        <FinalCta />
        <PilotPanel />
      </div>
      <Footer />
    </main>
  );
};

export default Home;
