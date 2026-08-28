// app/(customer)/home/_components/HomeGreeting.tsx
import { Lock } from "lucide-react";

/**
 * Explicitly Africa/Lagos rather than the server's clock. This renders on the
 * server, which is UTC in every deployment target, so "Good morning" would
 * greet a customer ordering dinner. KiaKia prices in naira and operates in a
 * single, DST-free timezone, so naming it here is honest and stable — if the
 * platform ever runs in a second market, this needs the customer's own zone,
 * not a second guess.
 */
function greetingFor(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-NG", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: "Africa/Lagos",
    }).format(now),
  );

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Replaces the stock-photo banner this page used to open with. That banner
 * showed the same burger to every customer on every visit and said "Great
 * food, delivered fast" — a marketing line, on a page reached only by people
 * who have already signed up. A dashboard should open by telling you where
 * you stand, so this is a greeting and a state summary instead.
 */
export function HomeGreeting({ firstName }: { firstName: string | null }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-kk-line/60 bg-gradient-to-br from-kk-red-soft/70 via-kk-cream to-kk-orange/10 px-5 py-7 sm:px-8 sm:py-9">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-kk-orange/25 blur-3xl"
      />

      <div className="relative flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="font-inter text-[11px] font-semibold uppercase tracking-[0.24em] text-kk-red">
            {greetingFor(new Date())}
            {firstName ? `, ${firstName}` : ""}
          </p>
          <h1 className="mt-3 font-sora text-[clamp(1.75rem,5vw,2.75rem)] font-extrabold leading-[1.05] tracking-[-0.03em] text-kk-ink">
            What are we eating?
          </h1>
          <p className="mt-2.5 max-w-md font-inter text-[15px] leading-6 text-kk-cocoa">
            Kitchens nearest you come first. Your money waits in escrow until the code at your door
            releases it.
          </p>
        </div>

        <span className="inline-flex items-center gap-2 rounded-full border border-kk-green/25 bg-kk-mint/30 px-3.5 py-2 font-inter text-xs font-semibold text-kk-green">
          <Lock className="size-3.5" />
          Escrow on every order
        </span>
      </div>
    </section>
  );
}
