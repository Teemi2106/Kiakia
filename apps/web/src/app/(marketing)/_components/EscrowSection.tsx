// app/(marketing)/_components/EscrowSection.tsx
import Link from "next/link";
import { ArrowRight, Banknote, Lock, Unlock } from "lucide-react";
import { Reveal } from "./Reveal";

const RECEIPT_LINES = [
  { label: "Jollof rice + chicken", amount: "₦4,200" },
  { label: "Suya platter (medium)", amount: "₦2,800" },
  { label: "Chapman", amount: "₦900" },
  { label: "Delivery", amount: "₦550" },
] as const;

const MONEY_TIMELINE = [
  {
    icon: Banknote,
    title: "You pay",
    body: "Card or transfer at checkout. Normal, boring, done in seconds.",
    accent: "bg-kk-orange/20 text-kk-orange",
  },
  {
    icon: Lock,
    title: "KiaKia holds it",
    body: "Not the vendor's balance, not spendable by us. It sits still while the food moves.",
    accent: "bg-white/10 text-white",
  },
  {
    icon: Unlock,
    title: "Your code releases it",
    body: "Four digits at your door, and vendor and rider are paid out in the same moment.",
    accent: "bg-kk-mint/25 text-kk-mint",
  },
] as const;

export function EscrowSection() {
  return (
    <section
      id="escrow"
      className="relative scroll-mt-24 overflow-hidden bg-kk-ink-deep px-4 py-20 sm:px-6 sm:py-28 lg:px-8"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="kk-grid absolute inset-0 text-white/5" />
        <div className="kk-blob -left-32 top-0 size-[520px] bg-kk-red/30" />
        <div className="kk-blob -right-24 bottom-0 size-[460px] bg-kk-green/25" />
      </div>

      <div className="relative mx-auto grid max-w-7xl items-center gap-16 lg:grid-cols-[1fr_0.95fr] lg:gap-12">
        {/* ------------------------------------------------------ copy */}
        <div>
          <Reveal>
            <p className="flex items-center gap-3 font-inter text-[11px] font-semibold uppercase tracking-[0.28em] text-kk-mint">
              <span className="h-px w-8 bg-kk-mint/50" />
              Zero-trust delivery
            </p>
            <h2 className="mt-5 font-sora text-[clamp(2rem,4.8vw,3.5rem)] font-extrabold leading-[1.02] tracking-[-0.035em] text-white">
              Nobody gets paid
              <br className="hidden sm:block" /> until you say so.
            </h2>
            <p className="mt-5 max-w-lg font-inter text-lg leading-8 text-white/65">
              Most delivery apps ask you to trust a stranger with your money and hope. KiaKia
              removes the hoping. Your payment is parked in escrow from checkout until the
              hand-off, and one 4-digit code is the only key that opens it.
            </p>
          </Reveal>

          <ol className="mt-12 space-y-1">
            {MONEY_TIMELINE.map((step, i) => (
              <Reveal key={step.title} delay={i * 120}>
                <li className="relative flex gap-5 pb-9 last:pb-0">
                  {/* Rail joining this marker to the next one. */}
                  {i < MONEY_TIMELINE.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[23px] top-12 h-[calc(100%-2.5rem)] w-px bg-gradient-to-b from-white/25 to-white/5"
                    />
                  )}
                  <span
                    className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset ring-white/15 ${step.accent}`}
                  >
                    <step.icon className="size-5" />
                  </span>
                  <span className="pt-1">
                    <span className="block font-sora text-lg font-bold text-white">
                      {step.title}
                    </span>
                    <span className="mt-1 block max-w-md font-inter text-[15px] leading-7 text-white/55">
                      {step.body}
                    </span>
                  </span>
                </li>
              </Reveal>
            ))}
          </ol>

          <Reveal delay={140}>
            <Link
              href="#faq"
              className="group mt-4 inline-flex items-center gap-2 font-inter text-[15px] font-semibold text-kk-mint transition-colors hover:text-white"
            >
              What if something goes wrong?
              <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </Reveal>
        </div>

        {/* --------------------------------------------------- receipt */}
        <Reveal delay={160} className="lg:justify-self-end">
          <div className="group relative mx-auto w-full max-w-[400px] -rotate-[1.5deg] transition-transform duration-700 hover:rotate-0">
            <div className="overflow-hidden rounded-[28px] bg-kk-cream shadow-[0_50px_90px_-30px_rgba(0,0,0,0.7)]">
              {/* --- top: the order --- */}
              <div className="px-7 pt-7">
                <div className="flex items-baseline justify-between">
                  <span className="font-sora text-xl font-extrabold tracking-tight text-kk-red">
                    KiaKia
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-kk-cocoa">
                    #KK-2481
                  </span>
                </div>

                <dl className="mt-6 space-y-3">
                  {RECEIPT_LINES.map((line) => (
                    <div key={line.label} className="flex items-baseline gap-3">
                      <dt className="font-inter text-[15px] text-kk-cocoa">{line.label}</dt>
                      <span
                        aria-hidden="true"
                        className="min-w-6 flex-1 translate-y-[-3px] border-b border-dotted border-kk-line"
                      />
                      <dd className="font-mono text-[15px] tabular-nums text-kk-ink">
                        {line.amount}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-6 flex items-baseline justify-between border-t border-kk-line pt-4">
                  <span className="font-inter text-sm font-semibold uppercase tracking-wider text-kk-cocoa">
                    Held in escrow
                  </span>
                  <span className="font-sora text-2xl font-extrabold tracking-tight text-kk-ink">
                    ₦8,450
                  </span>
                </div>
              </div>

              {/* --- tear line, notched out with two background-coloured
                      circles so the punch-outs always land on the divider --- */}
              <div className="relative my-6 h-px">
                <span
                  aria-hidden="true"
                  className="absolute inset-x-6 top-0 border-t-2 border-dashed border-kk-line"
                />
                <span
                  aria-hidden="true"
                  className="absolute -left-3.5 top-1/2 size-7 -translate-y-1/2 rounded-full bg-kk-ink-deep"
                />
                <span
                  aria-hidden="true"
                  className="absolute -right-3.5 top-1/2 size-7 -translate-y-1/2 rounded-full bg-kk-ink-deep"
                />
              </div>

              {/* --- bottom: the code --- */}
              <div className="relative px-7 pb-8">
                <p className="font-inter text-[11px] font-semibold uppercase tracking-[0.22em] text-kk-cocoa">
                  Delivery code
                </p>

                <div className="mt-4 flex gap-3">
                  {["4", "0", "9", "1"].map((digit, i) => (
                    <span
                      key={`${digit}-${i}`}
                      className="kk-digit flex h-16 flex-1 items-center justify-center rounded-2xl border-2 border-kk-ink/15 bg-white font-sora text-[32px] font-extrabold tracking-[-0.04em] text-kk-ink"
                      style={{ "--kk-delay": `${i * 500}ms` } as React.CSSProperties}
                    >
                      {digit}
                    </span>
                  ))}
                </div>

                <p className="mt-4 font-inter text-[13px] leading-5 text-kk-cocoa">
                  Read this out at your door. That is the entire security model.
                </p>

                {/* Rubber stamp — lands once the last digit has settled. */}
                <span
                  aria-hidden="true"
                  className="kk-stamp pointer-events-none absolute -right-2 bottom-4 rounded-xl border-[3px] border-kk-green/70 px-3 py-1.5 font-sora text-[13px] font-extrabold uppercase tracking-[0.14em] text-kk-green/80"
                >
                  Payment released
                </span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
