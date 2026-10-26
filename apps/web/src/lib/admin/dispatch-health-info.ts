/**
 * Pure reader for admin_dispatch_health() (the dispatch timer's health).
 * Defensive: anything unreadable becomes the 'unknown' state, never a throw.
 */

export interface DispatchProblem {
  readonly message: string;
  /** Plain next step for the admin, or null when we do not know one. */
  readonly nextStep: string | null;
}

export type DispatchHealth =
  | { readonly state: "unknown" }
  | {
      readonly state: "healthy" | "unhealthy";
      readonly problems: readonly DispatchProblem[];
      /** Seconds since the timer last ran; null when it never has. */
      readonly lastRanSecondsAgo: number | null;
      readonly lastRanText: string;
    };

const UNKNOWN: DispatchHealth = { state: "unknown" };

/** "4 minutes ago", "just now", "1 hour 5 minutes ago". */
export function formatAgo(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourText = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return rest === 0 ? `${hourText} ago` : `${hourText} ${rest} ${rest === 1 ? "minute" : "minutes"} ago`;
}

/** Suggested next step for a problem the database words in plain language; matched on keywords. */
export function nextStepFor(message: string): string | null {
  const text = message.toLowerCase();
  if (/(notification|push|text|sms|secret|alert)/.test(text)) return "Rider push and text alerts are not set up yet. Ask your developer to finish setting them up.";
  if (/(timer|scheduler|cron|tick|not running|overdue)/.test(text)) return "Ask your developer to check the scheduler (pg_cron).";
  return null;
}

export function readDispatchHealth(raw: unknown): DispatchHealth {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return UNKNOWN;
  const row = raw as Record<string, unknown>;
  if (typeof row.healthy !== "boolean") return UNKNOWN;

  const messages = Array.isArray(row.problems) ? row.problems.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
  const lastRanAt = typeof row.tick_last_run_at === "string" ? Date.parse(row.tick_last_run_at) : NaN;
  const overdue = typeof row.tick_overdue_seconds === "number" && Number.isFinite(row.tick_overdue_seconds) ? row.tick_overdue_seconds : null;
  // The RPC gives how late the timer is, not how long ago it ran; derive the age from the timestamp.
  const lastRanSecondsAgo = Number.isFinite(lastRanAt) ? Math.max(0, Math.round((Date.now() - lastRanAt) / 1000)) : null;
  const lastRanText = lastRanSecondsAgo === null ? "It has not run yet." : `It last ran ${formatAgo(lastRanSecondsAgo)}.`;

  const problems: DispatchProblem[] = messages.map((message) => ({ message, nextStep: nextStepFor(message) }));
  // Unhealthy with no wording from the database: say something rather than show an empty banner.
  if (!row.healthy && problems.length === 0) {
    const timerOff = row.tick_job_present === false || row.cron_available === false || overdue !== null;
    problems.push({
      message: "The dispatch timer is not running as it should.",
      nextStep: timerOff ? "Ask your developer to check the scheduler (pg_cron)." : null,
    });
  }

  return { state: row.healthy ? "healthy" : "unhealthy", problems, lastRanSecondsAgo, lastRanText };
}
