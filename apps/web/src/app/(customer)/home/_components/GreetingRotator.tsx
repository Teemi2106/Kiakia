// app/(customer)/home/_components/GreetingRotator.tsx
"use client";

import { cn } from "@kiakia/ui";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { GREETINGS, PROMPTS, type DayPeriod } from "../_lib/greetings";

const INTERVAL_MS = 10_000;

/**
 * The hero's greeting line and headline, cycling through the day's greetings
 * (English, Yoruba, Pidgin) and meal prompts together.
 *
 * Every variant is rendered into one grid cell and only the active one is
 * visible, so the block is always as tall as its longest variant and nothing
 * below it jumps as the text changes. The period comes from the server, so the
 * first paint (index 0, plain English) matches on both sides; it only starts
 * moving after mount, and not at all under prefers-reduced-motion.
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
  const activeGreeting = tick % greetings.length;
  const activePrompt = tick % prompts.length;
  const name = firstName ? `, ${firstName}` : "";

  return (
    <>
      <p className="flex items-center gap-2 font-inter text-[11px] font-semibold uppercase tracking-[0.24em] text-kk-orange">
        <Sparkles className="size-3.5 shrink-0" />
        <span className="grid">
          {greetings.map((greeting, i) => (
            <span
              key={greeting}
              aria-hidden={i !== activeGreeting}
              className={cn(
                "col-start-1 row-start-1 transition-all duration-500",
                i === activeGreeting ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
              )}
            >
              {greeting}
              {name}
            </span>
          ))}
        </span>
      </p>
      <h1 className="mt-4 grid max-w-xl font-sora text-[clamp(1.9rem,5.4vw,3.4rem)] font-extrabold leading-[1.02] tracking-[-0.04em] text-white">
        {prompts.map((prompt, i) => (
          <span
            key={prompt}
            aria-hidden={i !== activePrompt}
            className={cn(
              "col-start-1 row-start-1 transition-all duration-500",
              i === activePrompt ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
            )}
          >
            {prompt}
          </span>
        ))}
      </h1>
    </>
  );
}
