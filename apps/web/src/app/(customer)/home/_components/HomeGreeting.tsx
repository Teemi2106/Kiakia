// app/(customer)/home/_components/HomeGreeting.tsx
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

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
export function HomeGreeting({
  firstName,
  heroImageUrl,
}: {
  firstName: string | null;
  heroImageUrl?: string | null;
}) {
  return (
    <section className="relative min-h-[310px] overflow-hidden rounded-[2rem] bg-kk-ink-deep shadow-[0_28px_70px_-35px_rgba(81,22,12,0.65)] sm:min-h-[350px]">
      {heroImageUrl && (
        <Image
          src={heroImageUrl}
          alt=""
          fill
          priority
          sizes="(min-width: 1280px) 1280px, 100vw"
          className="object-cover object-center opacity-75"
        />
      )}
      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-kk-ink-deep via-kk-ink-deep/80 to-kk-ink-deep/15" />
      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-kk-ink-deep/65 via-transparent to-transparent" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-16 -top-24 size-72 rounded-full bg-kk-red/30 blur-3xl"
      />

      <div className="relative flex min-h-[310px] max-w-2xl flex-col justify-center px-6 py-9 sm:min-h-[350px] sm:px-10 sm:py-12">
          <p className="flex items-center gap-2 font-inter text-[11px] font-semibold uppercase tracking-[0.24em] text-kk-orange">
            <Sparkles className="size-3.5" />
            {greetingFor(new Date())}
            {firstName ? `, ${firstName}` : ""}
          </p>
          <h1 className="mt-4 max-w-xl font-sora text-[clamp(2rem,6vw,3.8rem)] font-extrabold leading-[0.98] tracking-[-0.045em] text-white">
            Your next favourite meal is closer than you think.
          </h1>
          <p className="mt-4 max-w-lg font-inter text-[15px] leading-6 text-white/72 sm:text-base">
            Chosen around your taste, your location and the meals you come back for.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="#vendor-results" className="inline-flex h-11 items-center gap-2 rounded-full bg-kk-orange px-5 font-inter text-sm font-bold text-kk-ink-deep transition hover:-translate-y-0.5 hover:bg-white">
              Explore your picks <ArrowRight className="size-4" />
            </Link>
            <span className="inline-flex items-center gap-1.5 font-inter text-xs font-medium text-white/65">
              <ShieldCheck className="size-4 text-kk-mint" /> Trusted local kitchens
            </span>
          </div>
        </div>
    </section>
  );
}
