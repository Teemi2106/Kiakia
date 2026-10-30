// app/(customer)/home/_components/GreetingRotator.tsx
"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { GREETINGS, PROMPTS, type DayPeriod } from "../_lib/greetings";

const INTERVAL_MS = 10 * 60_000;

/**
 * The hero's greeting line and headline, cycling through the day's greetings
 * (English, Yoruba, Pidgin) and meal prompts together.
 *
 * Only the active text is rendered, so the headline is exactly as tall as what
 * it says and sits flush against the line below it. The period comes from the
 * server, so the first paint (index 0, plain English) matches on both sides; it
 * only starts moving after mount, and not at all under prefers-reduced-motion.
 */
export function GreetingRotator({
  period,
  firstName,
}: {
  period: DayPeriod;
  firstName: string | null;
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setTick((t) => t + 1), INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  const greetings = GREETINGS[period];
  const prompts = PROMPTS[period];
  const greeting = greetings[tick % greetings.length];
  const prompt = prompts[tick % prompts.length];
  const name = firstName ? `, ${firstName}` : "";

  return (
    <>
      <p className="flex items-center gap-2 font-inter text-[11px] font-semibold uppercase tracking-[0.24em] text-kk-orange">
        <Sparkles className="size-3.5 shrink-0" />
        <span key={greeting} className="kk-swap">
          {greeting}
          {name}
        </span>
      </p>
      <h1 className="mt-4 max-w-xl font-sora text-[clamp(1.9rem,5.4vw,3.4rem)] font-extrabold leading-[1.02] tracking-[-0.04em] text-white">
        <span key={prompt} className="kk-swap block">
          {prompt}
        </span>
      </h1>
    </>
  );
}
