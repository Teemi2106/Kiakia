// app/(customer)/home/_components/HomeGreeting.tsx
import { ArrowRight, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { GREETINGS, periodFor, PROMPTS } from "../_lib/greetings";
import { GreetingRotator } from "./GreetingRotator";

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
  // Picked here, on the server, so the first paint and hydration agree.
  const period = periodFor(new Date());
  const initialGreeting = Math.floor(Math.random() * GREETINGS[period].length);
  const initialPrompt = Math.floor(Math.random() * PROMPTS[period].length);

  return (
    <section className="relative min-h-[190px] overflow-hidden rounded-[1.5rem] bg-kk-ink-deep shadow-[0_28px_70px_-35px_rgba(81,22,12,0.65)] sm:min-h-[350px] sm:rounded-[2rem]">
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

      <div className="relative flex min-h-[190px] max-w-2xl flex-col justify-center px-5 py-5 sm:min-h-[350px] sm:px-10 sm:py-12">
          <GreetingRotator
            period={period}
            firstName={firstName}
            initialGreeting={initialGreeting}
            initialPrompt={initialPrompt}
          />
          <p className="mt-4 hidden max-w-lg font-inter text-[15px] leading-6 text-white/72 sm:block sm:text-base">
            Chosen around your taste, your location and the meals you come back for.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3 sm:mt-7">
            <Link href="#vendor-results" className="inline-flex h-10 items-center gap-2 rounded-full bg-kk-orange px-4 font-inter text-xs font-bold text-kk-ink-deep transition hover:-translate-y-0.5 hover:bg-white sm:h-11 sm:px-5 sm:text-sm">
              Explore your picks <ArrowRight className="size-4" />
            </Link>
            <span className="hidden items-center gap-1.5 font-inter text-xs font-medium text-white/65 sm:inline-flex">
              <ShieldCheck className="size-4 text-kk-mint" /> Verified kitchens
            </span>
          </div>
        </div>
    </section>
  );
}
