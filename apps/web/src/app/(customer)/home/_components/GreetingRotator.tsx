// app/(customer)/home/_components/GreetingRotator.tsx
"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { GREETINGS, PROMPTS, type DayPeriod } from "../_lib/greetings";

const INTERVAL_MS = 10 * 60_000;

/** A random index in [0, length) that differs from `current` (when there is a
 * choice), so a swap is never a no-op. */
function pickOther(length: number, current: number): number {
  if (length < 2) return 0;
  const next = Math.floor(Math.random() * (length - 1));
  return next >= current ? next + 1 : next;
}

/**
 * The hero's greeting line and headline: a random greeting (English, Yoruba or
 * Pidgin) and a random meal prompt for the time of day, re-drawn every ten
 * minutes while the page stays open.
 *
 * The first pick is made on the server and passed in, so the server render and
 * hydration agree (no flash, no mismatch). Only the active text is rendered, so
 * the headline sits flush against the line below it. Nothing re-draws under
 * prefers-reduced-motion.
 */
export function GreetingRotator({
  period,
  firstName,
  initialGreeting,
  initialPrompt,
}: {
  period: DayPeriod;
  firstName: string | null;
  initialGreeting: number;
  initialPrompt: number;
}) {
  const [picked, setPicked] = useState({ greeting: initialGreeting, prompt: initialPrompt });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setPicked((current) => ({
        greeting: pickOther(GREETINGS[period].length, current.greeting),
        prompt: pickOther(PROMPTS[period].length, current.prompt),
      }));
    }, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [period]);

  const greetings = GREETINGS[period];
  const prompts = PROMPTS[period];
  const greeting = greetings[picked.greeting] ?? greetings[0];
  const prompt = prompts[picked.prompt] ?? prompts[0];
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
