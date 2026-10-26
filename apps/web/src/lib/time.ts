/**
 * Clock times for orders and dispatch, always in Lagos time (the server and the
 * browser can be in any zone). Pure; no server-only imports.
 */

export const LAGOS_TIME_ZONE = "Africa/Lagos";

/** "16:38" in Lagos time, or null when the value is missing or not a date. */
export function formatLagosTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: LAGOS_TIME_ZONE });
}

/** "21 Oct, 16:38" in Lagos time, or null. For history rows that can span days. */
export function formatLagosDateTime(iso: string | null | undefined): string | null {
  const time = formatLagosTime(iso);
  if (!time || !iso) return null;
  const day = new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: LAGOS_TIME_ZONE });
  return `${day}, ${time}`;
}

/** Whole minutes from `nowMs` until `iso`, rounded up; never negative. Null when `iso` is missing or invalid. */
export function minutesUntil(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 60_000));
}
