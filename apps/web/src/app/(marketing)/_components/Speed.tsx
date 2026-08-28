// app/(marketing)/_components/Speed.tsx
import { Bike, ChefHat, DoorOpen, Zap } from "lucide-react";
import { Reveal } from "./Reveal";

const BEATS = [
  { icon: Zap, label: "Order placed", note: "You hit pay" },
  { icon: ChefHat, label: "Vendor accepts", note: "Pan's already hot" },
  { icon: Bike, label: "Rider claims it", note: "First to tap, first to ride" },
  { icon: DoorOpen, label: "Knock knock", note: "Code, food, done" },
] as const;

const MECHANICS = [
  {
    title: "Nothing gets batched",
    body: "Your dinner is never held back so it can share a bike with three other drops. One order, one run, straight to you.",
  },
  {
    title: "Every rider hears at once",
    body: "The moment a vendor accepts, the offer goes out to every rider around them together. Whoever taps first is already moving.",
  },
  {
    title: "Down the road, not across town",
    body: "Kitchens and shops from your own area. Short trips are fast because of the map, not because someone had to ride like a maniac.",
  },
] as const;

export function Speed() {
  return (
    <section className="relative overflow-hidden bg-kk-cream px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="kk-blob -right-40 top-0 size-[520px] bg-kk-orange/30" />
        <div className="kk-blob -left-32 bottom-0 size-[420px] bg-kk-red/20" />
      </div>

      <div className="relative mx-auto max-w-7xl">
        <Reveal>
          <p className="flex items-center gap-3 font-inter text-[11px] font-semibold uppercase tracking-[0.28em] text-kk-red">
            <span className="h-px w-8 bg-kk-red/50" />
            Why the name
          </p>

          <div className="mt-6 flex items-center gap-4 sm:gap-8">
            {/* Motion streaks trailing into the wordmark. */}
            <div aria-hidden="true" className="hidden shrink-0 flex-col items-end gap-2.5 sm:flex">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="kk-streak block h-1.5 rounded-full bg-kk-red/70"
                  style={
                    {
                      width: `${[52, 84, 36, 66][i]}px`,
                      "--kk-delay": `${i * 160}ms`,
                    } as React.CSSProperties
                  }
                />
              ))}
            </div>

            <h2 className="min-w-0 font-sora font-extrabold leading-[0.85] tracking-[-0.05em]">
              <span className="block bg-gradient-to-r from-kk-red via-kk-red to-kk-orange bg-clip-text text-[clamp(3.25rem,13vw,9rem)] text-transparent">
                Kia kia
              </span>
              <span className="mt-3 block text-[clamp(1.5rem,4vw,2.75rem)] leading-[1.05] tracking-[-0.03em] text-kk-ink">
                means <span className="text-kk-cocoa">quick quick.</span>
              </span>
            </h2>
          </div>

          <p className="mt-8 max-w-2xl font-inter text-lg leading-8 text-kk-cocoa sm:text-xl">
            Not &ldquo;your order has been received.&rdquo; Not a forty-minute window that quietly
            turns into ninety. Kia kia is a promise about{" "}
            <span className="font-semibold text-kk-ink">right now</span> — and the whole thing is
            built around keeping it.
          </p>
        </Reveal>

        {/* ------------------------------------------------ dispatch track */}
        <Reveal delay={120}>
          <div className="mt-16 sm:mt-20">
            <div className="relative h-1.5 rounded-full bg-kk-line/70">
              <span
                aria-hidden="true"
                className="kk-runner-fill absolute inset-0 rounded-full bg-gradient-to-r from-kk-orange to-kk-red"
              />
              {[0, 25, 50, 75].map((pos) => (
                <span
                  key={pos}
                  aria-hidden="true"
                  className="absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-white/70"
                  style={{ left: `${pos}%` }}
                />
              ))}
              {/* The comet that runs the length of the track. */}
              <span
                aria-hidden="true"
                className="kk-runner absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center"
              >
                <span className="absolute right-1/2 h-1.5 w-20 rounded-full bg-gradient-to-l from-kk-red to-transparent" />
                <span className="relative size-4 rounded-full bg-kk-red shadow-[0_0_0_6px_rgba(182,25,19,0.18)]" />
              </span>
            </div>

            <ol className="mt-7 grid grid-cols-2 gap-6 sm:grid-cols-4">
              {BEATS.map((beat) => (
                <li key={beat.label}>
                  <span className="flex items-center gap-2 font-sora text-[15px] font-bold text-kk-ink">
                    <beat.icon className="size-4 shrink-0 text-kk-red" />
                    {beat.label}
                  </span>
                  <span className="mt-1 block font-inter text-[13px] text-kk-cocoa">
                    {beat.note}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>

        {/* ----------------------------------------------------- mechanics */}
        <div className="mt-16 grid gap-5 md:grid-cols-3 sm:mt-20">
          {MECHANICS.map((item, i) => (
            <Reveal key={item.title} delay={i * 110} className="h-full">
              <article className="group h-full rounded-3xl border border-kk-line/80 bg-white/70 p-7 backdrop-blur transition-all duration-500 hover:-translate-y-1.5 hover:bg-white hover:shadow-[0_30px_60px_-30px_rgba(90,25,20,0.45)] sm:p-8">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-kk-red">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-4 font-sora text-xl font-bold tracking-tight text-kk-ink">
                  {item.title}
                </h3>
                <p className="mt-2.5 font-inter text-[15px] leading-7 text-kk-cocoa">{item.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
