// app/(customer)/home/_lib/greetings.ts

export type DayPeriod = "morning" | "afternoon" | "evening";

/**
 * Hours are read in Africa/Lagos rather than the server's clock: this runs on
 * the server, which is UTC in every deployment target, so a plain getHours()
 * would greet a customer ordering dinner with "Good morning". KiaKia operates
 * in one DST-free timezone, so naming it is honest and stable.
 */
export function periodFor(now: Date): DayPeriod {
  const hour = Number(
    new Intl.DateTimeFormat("en-NG", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: "Africa/Lagos",
    }).format(now),
  );

  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** English first, so the un-animated state (server render, reduced motion) is
 * always the plain greeting. Then Yoruba, then Pidgin. */
export const GREETINGS: Record<DayPeriod, readonly string[]> = {
  morning: ["Good morning", "Ẹ káàárọ̀", "Morning o, how you dey?"],
  afternoon: ["Good afternoon", "Ẹ káàsán", "Afternoon o, how body?"],
  evening: ["Good evening", "Ẹ kú ìrọ̀lẹ́", "Good evening o, how far?"],
};

export const PROMPTS: Record<DayPeriod, readonly string[]> = {
  morning: [
    "What's for breakfast?",
    "Morning cravings?",
    "What's cooking this morning?",
    "Start your morning right.",
    "Breakfast sorted?",
    "First meal, best meal.",
    "What's the morning looking like?",
  ],
  afternoon: [
    "What's for lunch?",
    "What's the plan for lunch?",
    "Lunch o'clock!",
    "What's on your plate today?",
    "Afternoon cravings?",
    "Time to chop?",
    "Lunch plans? We've got you.",
  ],
  evening: [
    "What's for dinner?",
    "What's the dinner plan?",
    "What are we eating tonight?",
    "Evening cravings?",
    "End the day with something good.",
    "No plans for dinner? Now you do.",
    "What's the night calling for?",
  ],
};
