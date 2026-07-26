import Link from "next/link";

const DashboardPage = () => {
  return (
    <div className="min-h-screen">
      <header className="border-b border-paper/15 px-5 py-5 sm:px-8 lg:px-12">
        <div className="flex items-center justify-between gap-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.19em] text-paper/40">
            Control plane / Overview
          </p>
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.17em] text-paper/35">
            <span className="size-1.5 bg-cobalt" aria-hidden="true" />
            Private session
          </div>
        </div>
      </header>

      <div className="px-5 py-12 sm:px-8 sm:py-16 lg:px-12 lg:py-20">
        <section className="max-w-5xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cobalt">
            Console foundation
          </p>
          <h1 className="mt-6 text-[clamp(3rem,7vw,7.2rem)] font-medium leading-[0.86] tracking-[-0.07em]">
            The control plane
            <br />
            <span className="font-serif font-normal italic text-paper/65">
              starts here.
            </span>
          </h1>
          <p className="mt-8 max-w-2xl text-base leading-relaxed text-paper/50 sm:text-lg">
            Your identity is connected and this workspace is private. API keys,
            task quotes, evidence, and billing will be added to this same
            ledger as each control-plane layer comes online.
          </p>
        </section>

        <section
          aria-labelledby="foundation-status"
          className="mt-16 border-y border-paper/15"
        >
          <h2 className="sr-only" id="foundation-status">
            Foundation status
          </h2>
          <div className="grid md:grid-cols-3">
            <div className="border-b border-paper/15 py-7 md:border-b-0 md:border-r md:pr-8">
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/35">
                  Identity
                </p>
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-cobalt">
                  Active
                </span>
              </div>
              <p className="mt-5 text-xl tracking-[-0.03em]">
                Supabase session
              </p>
            </div>

            <div className="border-b border-paper/15 py-7 md:border-b-0 md:border-r md:px-8">
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/35">
                  API access
                </p>
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-paper/30">
                  Next
                </span>
              </div>
              <p className="mt-5 text-xl tracking-[-0.03em]">
                No keys issued
              </p>
            </div>

            <div className="py-7 md:pl-8">
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/35">
                  Task ledger
                </p>
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-paper/30">
                  Empty
                </span>
              </div>
              <p className="mt-5 text-xl tracking-[-0.03em]">
                Ready for first quote
              </p>
            </div>
          </div>
        </section>

        <div className="mt-16 grid gap-12 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <section aria-labelledby="next-layers">
            <div className="flex items-end justify-between gap-6 border-b border-paper/15 pb-5">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/35">
                  Build sequence
                </p>
                <h2
                  className="mt-3 text-2xl tracking-[-0.04em]"
                  id="next-layers"
                >
                  The next control layers
                </h2>
              </div>
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-paper/25">
                0 / 3
              </span>
            </div>

            <ol>
              <li className="grid grid-cols-[56px_1fr] border-b border-paper/10 py-6">
                <span className="font-mono text-xs text-cobalt">01</span>
                <div>
                  <h3 className="text-base">Issue an API key</h3>
                  <p className="mt-2 text-sm leading-relaxed text-paper/40">
                    Give coding agents a revocable identity without exposing
                    your Supabase credentials.
                  </p>
                </div>
              </li>
              <li className="grid grid-cols-[56px_1fr] border-b border-paper/10 py-6">
                <span className="font-mono text-xs text-paper/30">02</span>
                <div>
                  <h3 className="text-base">Quote a bounded task</h3>
                  <p className="mt-2 text-sm leading-relaxed text-paper/40">
                    Store the task, acceptance criteria, and fixed customer
                    price before execution.
                  </p>
                </div>
              </li>
              <li className="grid grid-cols-[56px_1fr] border-b border-paper/10 py-6">
                <span className="font-mono text-xs text-paper/30">03</span>
                <div>
                  <h3 className="text-base">Record proof and payment</h3>
                  <p className="mt-2 text-sm leading-relaxed text-paper/40">
                    Keep verification evidence and financial state attached to
                    the delivered outcome.
                  </p>
                </div>
              </li>
            </ol>
          </section>

          <aside className="border border-paper/15 bg-paper/[0.035] p-6 sm:p-8">
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/35">
              Current boundary
            </p>
            <p className="mt-5 font-serif text-3xl italic leading-tight text-paper/75">
              Private by default.
              <br />
              Explicit by design.
            </p>
            <p className="mt-6 text-sm leading-relaxed text-paper/45">
              Authentication now protects the console. Future customer data
              will add row-level ownership and server-authorized lifecycle
              changes.
            </p>
            <Link
              className="mt-10 inline-flex border-b border-paper/30 pb-1 text-sm text-paper transition-colors hover:border-cobalt hover:text-cobalt focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt"
              href="/"
            >
              Return to the public site
            </Link>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
