// app/(marketing)/_components/HowItWorks.tsx
import { Search, Utensils, Wallet } from "lucide-react";
import { Reveal } from "./Reveal";

const STEPS = [
  {
    n: "01",
    title: "Find your craving",
    body: "Real kitchens and shops from your own area — real menus, real prices, live opening hours. Nothing you tap turns out to be shut.",
    icon: Search,
    tint: "text-kk-red",
  },
  {
    n: "02",
    title: "Pay and forget about it",
    body: "Card or transfer, done in seconds. We hold your money safely while the vendor cooks, so there is nothing for you to worry about.",
    icon: Wallet,
    tint: "text-kk-orange-deep",
  },
  {
    n: "03",
    title: "Eat",
    body: "A rider brings it straight over — no detours, no other drops. You give a 4-digit code at the door, take your bag, and that is the whole ceremony.",
    icon: Utensils,
    tint: "text-kk-green",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-24 bg-kk-cream px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <div className="max-w-3xl">
            <p className="flex items-center gap-3 font-inter text-[11px] font-semibold uppercase tracking-[0.28em] text-kk-red">
              <span className="h-px w-8 bg-kk-red/50" />
              How it works
            </p>
            <h2 className="mt-5 font-sora text-[clamp(2rem,4.6vw,3.25rem)] font-extrabold leading-[1.03] tracking-[-0.03em] text-kk-ink">
              Three taps. One knock.
              <br className="hidden sm:block" /> Dinner.
            </h2>
            <p className="mt-5 max-w-xl font-inter text-lg leading-8 text-kk-cocoa">
              From the moment you tap order to the moment you are eating, there is nothing else you
              have to do. That is the entire point.
            </p>
          </div>
        </Reveal>

        <div className="relative mt-16 grid gap-12 md:mt-20 md:grid-cols-3 md:gap-8">
          {/* Dashed track linking the three icon tiles on wide screens. */}
          <div
            aria-hidden="true"
            className="kk-track absolute left-[10%] right-[10%] top-9 hidden h-0.5 text-kk-line md:block"
          />

          {STEPS.map((step, i) => (
            <Reveal key={step.n} delay={i * 130} className="relative">
              <div className="flex flex-col items-start">
                <span className="relative z-10 flex size-[72px] items-center justify-center rounded-3xl bg-white shadow-[0_18px_35px_-20px_rgba(28,27,27,0.5)] ring-1 ring-kk-line/70">
                  <step.icon className={`size-7 ${step.tint}`} />
                  <span className="absolute -right-2.5 -top-2.5 flex size-8 items-center justify-center rounded-full bg-kk-ink font-sora text-[11px] font-bold tracking-wide text-white ring-4 ring-kk-cream">
                    {step.n}
                  </span>
                </span>
                <h3 className="mt-7 font-sora text-2xl font-bold tracking-tight text-kk-ink">
                  {step.title}
                </h3>
                <p className="mt-3 max-w-sm font-inter text-[15px] leading-7 text-kk-cocoa">
                  {step.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <p className="mt-16 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-dashed border-kk-line bg-white/60 px-5 py-4 font-inter text-sm text-kk-cocoa">
            <span className="font-semibold text-kk-ink">And if it never turns up?</span>
            Your money never moved in the first place. Nothing to chase, nobody to argue with.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
