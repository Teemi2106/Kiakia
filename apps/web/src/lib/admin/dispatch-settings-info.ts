/**
 * Plain-language description of the rider-matching settings, shared by the
 * Settings page, the form's live preview, the zod schema and tests. No
 * server-only imports so it stays unit-testable and client-safe.
 *
 * Values are stored the way the database holds them (metres, a count, seconds);
 * the admin types km / a count / minutes.
 */

export const DISPATCH_SETTING_KEYS = [
  "dispatch_radius_m",
  "dispatch_max_riders",
  "dispatch_widen_after_seconds",
  "dispatch_notify_vendor_after_seconds",
  "dispatch_location_max_age_seconds",
] as const;
export type DispatchSettingKey = (typeof DISPATCH_SETTING_KEYS)[number];

export interface DispatchSettingsValues {
  readonly radiusM: number;
  readonly maxRiders: number;
  /** 0 = never widen. */
  readonly widenAfterSeconds: number;
  /** How long an order waits with nobody in range before the store is told. */
  readonly notifyVendorAfterSeconds: number;
}

type Unit = "km" | "count" | "minutes";

export interface DispatchSettingInfo {
  readonly key: DispatchSettingKey;
  readonly title: string;
  readonly what: string;
  /** Who is affected and what changes, in words. */
  readonly whoChanges: string;
  readonly appliesTo: string;
  readonly unit: Unit;
  readonly inputLabel: string;
  /** Smallest and largest stored value the form accepts (the database re-checks). */
  readonly min: number;
  readonly max: number;
  /** True when the value 0 is allowed even though it is below `min`. */
  readonly zeroAllowed?: boolean;
  /** Optional: only shown when the database has the setting. */
  readonly optional?: boolean;
}

export const DISPATCH_SETTINGS: readonly DispatchSettingInfo[] = [
  {
    key: "dispatch_radius_m",
    title: "How far from the store we look for riders",
    what: "When an order is ready, we offer it to online riders who are within this distance of the store. Set it to 0 for no limit: any online rider can be offered the order, nearest first.",
    whoChanges:
      "This does not change what customers pay or what riders earn for the delivery. A bigger distance means more riders can be offered an order, so it is more likely to be picked up, but a rider may have a longer ride to reach the store.",
    appliesTo: "Orders that become ready from now on. Offers already sent are unchanged.",
    unit: "km",
    inputLabel: "New distance (km, 0 = no limit)",
    min: 1000,
    max: 50_000,
    zeroAllowed: true,
  },
  {
    key: "dispatch_max_riders",
    title: "How many riders get each order offer",
    what: "Each order is offered to this many riders at the same time. The first one to accept gets it.",
    whoChanges:
      "A higher number gives the order more chances of being picked up quickly, but riders may find an offer gone when they tap it. A lower number is quieter for riders but slower if someone does not answer.",
    appliesTo: "Orders that become ready from now on. Offers already sent are unchanged.",
    unit: "count",
    inputLabel: "New number of riders",
    min: 1,
    max: 50,
  },
  {
    key: "dispatch_widen_after_seconds",
    title: "If nobody accepts, widen the search after",
    what: "If no rider has accepted an order after this long, we automatically look as far as the store's own delivery distance (each store sets its own). Set it to 0 to never widen.",
    whoChanges: "Riders further away may start getting offers sooner, up to how far that store delivers. Nobody pays differently; what riders earn for the delivery does not change.",
    appliesTo: "Orders that become ready from now on. Offers already sent are unchanged.",
    unit: "minutes",
    inputLabel: "New wait (minutes, 0 = never)",
    min: 1,
    max: 1800,
    zeroAllowed: true,
  },
  {
    key: "dispatch_notify_vendor_after_seconds",
    title: "Tell the store when no rider is near, after",
    what: "If no rider is in range of an order, the store is told after this long. The store can then ask us to look further away, or deliver the order itself.",
    whoChanges: "Nobody pays differently. A short time tells stores sooner but may alert them before riders have had a fair chance to come online.",
    appliesTo: "Orders that become ready from now on. Offers already sent are unchanged.",
    unit: "minutes",
    inputLabel: "New wait (minutes)",
    min: 10,
    max: 1800,
  },
  {
    key: "dispatch_location_max_age_seconds",
    title: "How recent a rider's location must be",
    what: "A rider is only offered orders if their phone has reported its location within this long.",
    whoChanges: "A longer time includes riders whose phone has been quiet for a while, but their real position may be out of date.",
    appliesTo: "Orders that become ready from now on. Offers already sent are unchanged.",
    unit: "minutes",
    inputLabel: "New time (minutes)",
    min: 60,
    max: 300,
    optional: true,
  },
];

export const DISPATCH_SETTING_INFO: Readonly<Record<DispatchSettingKey, DispatchSettingInfo>> = Object.fromEntries(
  DISPATCH_SETTINGS.map((info) => [info.key, info]),
) as Record<DispatchSettingKey, DispatchSettingInfo>;

/** 5000 -> "5 km", 8500 -> "8.5 km", 750 -> "0.75 km". */
export function formatKm(metres: number): string {
  const km = metres / 1000;
  return `${Number.isInteger(km) ? km : Number(km.toFixed(2))} km`;
}

/** 90 -> "1.5 minutes", 120 -> "2 minutes", 60 -> "1 minute", 0 -> "never". */
export function formatSeconds(seconds: number): string {
  if (seconds <= 0) return "never";
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = seconds / 60;
  const text = Number.isInteger(minutes) ? String(minutes) : String(Number(minutes.toFixed(1)));
  return `${text} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** How a stored value reads on the page. */
export function formatDispatchValue(key: DispatchSettingKey, value: number): string {
  const info = DISPATCH_SETTING_INFO[key];
  if (key === "dispatch_radius_m" && value === 0) return "No limit";
  if (info.unit === "km") return formatKm(value);
  if (info.unit === "count") return value === 1 ? "1 rider" : `${value} riders`;
  return formatSeconds(value);
}

/** What goes in the edit box for the current stored value. */
export function dispatchInputValue(key: DispatchSettingKey, value: number): string {
  const info = DISPATCH_SETTING_INFO[key];
  if (info.unit === "km") return String(value / 1000);
  if (info.unit === "minutes") return String(Number((value / 60).toFixed(2)));
  return String(value);
}

/** What the admin typed to the stored value, or null while it is not a valid number. */
export function parseDispatchInput(key: DispatchSettingKey, typed: string): number | null {
  const info = DISPATCH_SETTING_INFO[key];
  const text = typed.trim();
  if (info.unit === "count") return /^\d{1,3}$/.test(text) ? Number(text) : null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * (info.unit === "km" ? 1000 : 60));
}

/** The plain-words range error for a parsed value, or null when it is within range. */
export function dispatchRangeError(key: DispatchSettingKey, value: number): string | null {
  const info = DISPATCH_SETTING_INFO[key];
  if (info.zeroAllowed && value === 0) return null;
  if (value >= info.min && value <= info.max) return null;
  const low = info.zeroAllowed ? `0 or at least ${formatDispatchValue(key, info.min)}` : `at least ${formatDispatchValue(key, info.min)}`;
  return `${info.title}: choose a value that is ${low} and no more than ${formatDispatchValue(key, info.max)}.`;
}

/** The example distance used in the "would a rider this far be offered the order" sentence. */
const EXAMPLE_RIDER_M = 8500;

/** One-sentence "what this means" for a (current or proposed) value. */
export function dispatchPreview(key: DispatchSettingKey, value: number, ctx: DispatchSettingsValues): string {
  switch (key) {
    case "dispatch_radius_m": {
      if (value === 0) return "There is no distance limit: any online rider can be offered a new order, however far from the store.";
      const verdict = EXAMPLE_RIDER_M <= value ? "can be offered" : "cannot be offered";
      return `We look for riders within ${formatKm(value)} of the store. A rider ${formatKm(EXAMPLE_RIDER_M)} away ${verdict} a new order (until the search widens).`;
    }
    case "dispatch_max_riders":
      return `Each order is offered to up to ${value === 1 ? "1 rider" : `${value} riders`} at the same time.`;
    case "dispatch_widen_after_seconds":
      if (value === 0) return "We never widen the search on our own: if nobody within the normal distance accepts, the order waits until someone steps in.";
      if (ctx.radiusM === 0) return "The normal distance has no limit, so there is nothing to widen.";
      return `If nobody has accepted after ${formatSeconds(value)}, we automatically look as far as the store's own delivery distance (each store sets its own, for example 20 km).`;
    case "dispatch_notify_vendor_after_seconds":
      return `If no rider is in range after ${formatSeconds(value)}, the store is told, and can ask us to look further away or deliver the order itself.`;
    case "dispatch_location_max_age_seconds":
      return `Riders whose phone has not reported a location in the last ${formatSeconds(value)} are not offered orders.`;
  }
}

/** The single sentence under the edit box: what is wrong with what is typed, or what saving would mean. */
export function dispatchPreviewFor(info: DispatchSettingInfo, typed: string, current: DispatchSettingsValues): { text: string; problem: boolean } {
  const value = parseDispatchInput(info.key, typed);
  if (value === null) {
    return { text: info.unit === "count" ? "Enter a whole number, for example 5." : "Enter a plain number, for example 5 or 7.5.", problem: true };
  }
  const problem = dispatchRangeError(info.key, value);
  if (problem) return { text: problem, problem: true };

  const next: DispatchSettingsValues = {
    radiusM: info.key === "dispatch_radius_m" ? value : current.radiusM,
    maxRiders: info.key === "dispatch_max_riders" ? value : current.maxRiders,
    widenAfterSeconds: info.key === "dispatch_widen_after_seconds" ? value : current.widenAfterSeconds,
    notifyVendorAfterSeconds: info.key === "dispatch_notify_vendor_after_seconds" ? value : current.notifyVendorAfterSeconds,
  };
  return { text: `If you save: ${dispatchPreview(info.key, value, next)}`, problem: false };
}
