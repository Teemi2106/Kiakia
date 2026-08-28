// app/(customer)/home/_lib/opening-hours.ts
//
// "Open Now" filter support. vendors.opening_hours is jsonb: either '{}'
// (never configured, per (vendor)/dashboard/settings/page.tsx's own comment)
// or a 7-entry array of { day, isOpen, opensAt, closesAt } matching
// JS Date#getDay() (0 = Sunday .. 6 = Saturday) — see
// (vendor)/dashboard/settings/_components/types.ts (DayHours) and
// OperatingHours.tsx, which is the only writer of this column.

const WAT_TIME_ZONE = "Africa/Lagos";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface DayHours {
  day: number;
  isOpen: boolean;
  opensAt: string; // "HH:MM"
  closesAt: string;
}

function isDayHoursArray(value: unknown): value is DayHours[] {
  return (
    Array.isArray(value) &&
    value.length === 7 &&
    value.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof (entry as DayHours).day === "number" &&
        typeof (entry as DayHours).isOpen === "boolean" &&
        typeof (entry as DayHours).opensAt === "string" &&
        typeof (entry as DayHours).closesAt === "string",
    )
  );
}

function parseHhMm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Current day-of-week (0=Sun..6=Sat) and minutes-since-midnight, in
 * Africa/Lagos local time — vendors set opensAt/closesAt in local time and
 * KiaKia only operates in one Nigerian timezone (no DST), so this is a
 * fixed +1:00 offset from UTC regardless of where the server process runs. */
function nowInLagos(): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: WAT_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const day = WEEKDAYS.indexOf(byType.weekday as (typeof WEEKDAYS)[number]);
  // hour12: false can format midnight as "24" in some ICU implementations.
  const hour = Number(byType.hour) % 24;
  const minute = Number(byType.minute);
  return { day, minutes: hour * 60 + minute };
}

/**
 * Whether a vendor is open right now. Vendors that have never configured
 * opening_hours (opening_hours = '{}') fall back to is_accepting_orders,
 * the same signal the rest of the app already treats as "open" (vendor
 * cards elsewhere badge on this field) — we don't invent a false "closed"
 * state for a store that simply hasn't filled in a schedule yet.
 */
export function isVendorOpenNow(vendor: {
  is_accepting_orders: boolean;
  opening_hours: unknown;
}): boolean {
  if (!vendor.is_accepting_orders) return false;
  if (!isDayHoursArray(vendor.opening_hours)) return true;

  const { day, minutes } = nowInLagos();
  const today = vendor.opening_hours.find((entry) => entry.day === day);
  if (!today || !today.isOpen) return false;

  const opensAt = parseHhMm(today.opensAt);
  const closesAt = parseHhMm(today.closesAt);
  if (opensAt === null || closesAt === null) return true;

  if (closesAt > opensAt) {
    return minutes >= opensAt && minutes < closesAt;
  }
  // Overnight window (closes after midnight, e.g. 18:00 -> 02:00).
  return minutes >= opensAt || minutes < closesAt;
}
