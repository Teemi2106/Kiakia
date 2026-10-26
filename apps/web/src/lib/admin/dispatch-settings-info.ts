/**
 * Plain-language description of the rider-matching settings, shared by the
 * Settings page, the form's live preview, the zod schema and tests. No
 * server-only imports so it stays unit-testable and client-safe.
 *
 * Values are stored the way the database holds them (metres, seconds, a count);
 * the admin types km / minutes / seconds / a plain number, depending on the setting.
 * The bounds mirror admin_set_dispatch_setting (0102); the database re-checks them.
 */

export const DISPATCH_SETTING_KEYS = [
  "dispatch_offer_timeout_seconds",
  "dispatch_max_riders",
  "dispatch_radius_m",
  "dispatch_widen_after_seconds",
  "dispatch_h3_resolution",
  "dispatch_h3_initial_ring",
  "dispatch_h3_max_ring",
  "dispatch_secure_buffer_seconds",
  "dispatch_default_travel_seconds",
  "dispatch_default_speed_kmh",
  "dispatch_road_factor_pct",
  "dispatch_min_history_samples",
  "dispatch_vendor_arrival_radius_m",
  "dispatch_location_max_age_seconds",
  "dispatch_notify_vendor_after_seconds",
] as const;
export type DispatchSettingKey = (typeof DISPATCH_SETTING_KEYS)[number];

export interface DispatchSettingsValues {
  readonly offerTimeoutSeconds: number;
  readonly maxRiders: number;
  /** 0 = no limit. */
  readonly radiusM: number;
  /** 0 = never search further. */
  readonly widenAfterSeconds: number;
  /** Map grid level, 7 (large blocks) to 9 (small blocks). */
  readonly h3Resolution: number;
  readonly initialRing: number;
  readonly maxRing: number;
  readonly secureBufferSeconds: number;
  readonly defaultTravelSeconds: number;
  readonly defaultSpeedKmh: number;
  readonly roadFactorPct: number;
  readonly minHistorySamples: number;
  readonly arrivalRadiusM: number;
  readonly locationMaxAgeSeconds: number;
  /** How long an order waits with nobody in range before the store is told. */
  readonly notifyVendorAfterSeconds: number;
}

/** Which field of DispatchSettingsValues each key fills. */
export const DISPATCH_VALUE_FIELD: Readonly<Record<DispatchSettingKey, keyof DispatchSettingsValues>> = {
  dispatch_offer_timeout_seconds: "offerTimeoutSeconds",
  dispatch_max_riders: "maxRiders",
  dispatch_radius_m: "radiusM",
  dispatch_widen_after_seconds: "widenAfterSeconds",
  dispatch_h3_resolution: "h3Resolution",
  dispatch_h3_initial_ring: "initialRing",
  dispatch_h3_max_ring: "maxRing",
  dispatch_secure_buffer_seconds: "secureBufferSeconds",
  dispatch_default_travel_seconds: "defaultTravelSeconds",
  dispatch_default_speed_kmh: "defaultSpeedKmh",
  dispatch_road_factor_pct: "roadFactorPct",
  dispatch_min_history_samples: "minHistorySamples",
  dispatch_vendor_arrival_radius_m: "arrivalRadiusM",
  dispatch_location_max_age_seconds: "locationMaxAgeSeconds",
  dispatch_notify_vendor_after_seconds: "notifyVendorAfterSeconds",
};

/** What the database ships with (D10); used only when a setting row is missing. */
export const DISPATCH_DEFAULTS: DispatchSettingsValues = {
  offerTimeoutSeconds: 45,
  maxRiders: 10,
  radiusM: 0,
  widenAfterSeconds: 60,
  h3Resolution: 8,
  initialRing: 1,
  maxRing: 8,
  secureBufferSeconds: 150,
  defaultTravelSeconds: 600,
  defaultSpeedKmh: 18,
  roadFactorPct: 135,
  minHistorySamples: 20,
  arrivalRadiusM: 100,
  locationMaxAgeSeconds: 300,
  notifyVendorAfterSeconds: 45,
};

type Unit = "km" | "minutes" | "seconds" | "metres" | "riders" | "deliveries" | "blocks" | "level" | "kmh" | "pct";

export type DispatchSettingGroupId = "offers" | "search-area" | "timing" | "location" | "store-alerts";

export interface DispatchSettingInfo {
  readonly key: DispatchSettingKey;
  readonly group: DispatchSettingGroupId;
  readonly title: string;
  /** One or two short sentences: what the setting does. */
  readonly what: string;
  readonly appliesTo: string;
  readonly unit: Unit;
  readonly inputLabel: string;
  /** Smallest and largest stored value the form accepts (the database re-checks). */
  readonly min: number;
  readonly max: number;
  /** True when the value 0 is allowed even though it is below `min`. */
  readonly zeroAllowed?: boolean;
  /** Settings added after rider matching first shipped: hidden (not an error) if the database does not have the row yet. */
  readonly optional?: boolean;
}

const FROM_NOW_ON = "Orders from now on. Offers already sent are unchanged.";

export const DISPATCH_SETTINGS: readonly DispatchSettingInfo[] = [
  {
    key: "dispatch_offer_timeout_seconds",
    group: "offers",
    title: "Offer time",
    what: "How long one rider has to accept or decline before the next rider is asked.",
    appliesTo: FROM_NOW_ON,
    unit: "seconds",
    inputLabel: "New offer time (seconds, 15 to 120)",
    min: 15,
    max: 120,
    optional: true,
  },
  {
    key: "dispatch_max_riders",
    group: "offers",
    title: "Riders asked one at a time per round",
    what: "How many riders are asked, one after another, in a round. When a round ends with no one accepting, a new round starts.",
    appliesTo: FROM_NOW_ON,
    unit: "riders",
    inputLabel: "New number of riders",
    min: 1,
    max: 50,
  },
  {
    key: "dispatch_radius_m",
    group: "search-area",
    title: "First search distance",
    what: "At first we only look for riders within this distance of the store. 0 means no limit: any online rider can be asked, nearest first.",
    appliesTo: FROM_NOW_ON,
    unit: "km",
    inputLabel: "New distance (km, 0 = no limit)",
    min: 1000,
    max: 50_000,
    zeroAllowed: true,
  },
  {
    key: "dispatch_widen_after_seconds",
    group: "search-area",
    title: "Search further after",
    what: "If nobody has accepted after this long, we look as far as the store's own delivery distance. 0 means never. This only matters once a first search distance is set.",
    appliesTo: FROM_NOW_ON,
    unit: "minutes",
    inputLabel: "New wait (minutes, 0 = never)",
    min: 1,
    max: 1800,
    zeroAllowed: true,
  },
  {
    key: "dispatch_h3_resolution",
    group: "search-area",
    title: "Search area size",
    what: "Riders are grouped into map blocks. Small blocks look closer to the store, Large blocks cover more ground. 9 is Small, 8 is Medium, 7 is Large.",
    appliesTo: FROM_NOW_ON,
    unit: "level",
    inputLabel: "New block size (7 = Large, 8 = Medium, 9 = Small)",
    min: 7,
    max: 9,
    optional: true,
  },
  {
    key: "dispatch_h3_initial_ring",
    group: "search-area",
    title: "First search: nearby blocks",
    what: "How many blocks around the store's own block we look in first. 0 means only the store's own block.",
    appliesTo: FROM_NOW_ON,
    unit: "blocks",
    inputLabel: "New number of blocks (0 to 10)",
    min: 0,
    max: 10,
    optional: true,
  },
  {
    key: "dispatch_h3_max_ring",
    group: "search-area",
    title: "Furthest search: nearby blocks",
    what: "The most blocks around the store we will look in before falling back to the nearest riders overall. It cannot be smaller than the first search.",
    appliesTo: FROM_NOW_ON,
    unit: "blocks",
    inputLabel: "New number of blocks (1 to 30)",
    min: 1,
    max: 30,
    optional: true,
  },
  {
    key: "dispatch_secure_buffer_seconds",
    group: "timing",
    title: "Time allowed to find a rider",
    what: "For food that is still being prepared, the search starts this long before a rider needs to be on the way. Used until the system has learned a better figure from past offers.",
    appliesTo: FROM_NOW_ON,
    unit: "seconds",
    inputLabel: "New time (seconds, 45 to 900)",
    min: 45,
    max: 900,
    optional: true,
  },
  {
    key: "dispatch_default_travel_seconds",
    group: "timing",
    title: "Rider travel time when unknown",
    what: "How long we assume a rider needs to reach the store when we cannot work it out from where riders are.",
    appliesTo: FROM_NOW_ON,
    unit: "minutes",
    inputLabel: "New time (minutes, 1 to 60)",
    min: 60,
    max: 3600,
    optional: true,
  },
  {
    key: "dispatch_default_speed_kmh",
    group: "timing",
    title: "Rider average speed",
    what: "Used to estimate how long a rider takes to arrive, until enough deliveries show the real speed in that area.",
    appliesTo: FROM_NOW_ON,
    unit: "kmh",
    inputLabel: "New speed (km/h, 5 to 60)",
    min: 5,
    max: 60,
    optional: true,
  },
  {
    key: "dispatch_road_factor_pct",
    group: "timing",
    title: "Road distance vs straight line",
    what: "Roads are longer than a straight line on the map. At 135%, a 1 km straight line counts as 1.35 km of road.",
    appliesTo: FROM_NOW_ON,
    unit: "pct",
    inputLabel: "New percentage (100 to 250)",
    min: 100,
    max: 250,
    optional: true,
  },
  {
    key: "dispatch_min_history_samples",
    group: "timing",
    title: "Deliveries needed before learning",
    what: "An area's speed and search time are learned from past deliveries only after this many. Until then the defaults above are used.",
    appliesTo: FROM_NOW_ON,
    unit: "deliveries",
    inputLabel: "New number of deliveries (5 to 1000)",
    min: 5,
    max: 1000,
    optional: true,
  },
  {
    key: "dispatch_vendor_arrival_radius_m",
    group: "timing",
    title: "Rider counts as at the store within",
    what: "A rider is treated as having arrived at the store once they are this close to it.",
    appliesTo: FROM_NOW_ON,
    unit: "metres",
    inputLabel: "New distance (metres, 30 to 500)",
    min: 30,
    max: 500,
    optional: true,
  },
  {
    key: "dispatch_location_max_age_seconds",
    group: "location",
    title: "Rider location must be newer than",
    what: "A rider is only asked if their phone has reported its location within this long. This cannot be switched off.",
    appliesTo: FROM_NOW_ON,
    unit: "minutes",
    inputLabel: "New time (minutes, 1 to 5)",
    min: 60,
    max: 300,
    optional: true,
  },
  {
    key: "dispatch_notify_vendor_after_seconds",
    group: "store-alerts",
    title: "Tell the store no rider is near after",
    what: "If no rider is in range, the store is told after this long (0 = straight away) and can ask us to look further away or deliver the order itself.",
    appliesTo: FROM_NOW_ON,
    unit: "minutes",
    inputLabel: "New wait (minutes, 0 = straight away)",
    min: 1,
    max: 1800,
    zeroAllowed: true,
  },
];

export const DISPATCH_SETTING_GROUPS: readonly { readonly id: DispatchSettingGroupId; readonly title: string; readonly blurb: string }[] = [
  { id: "offers", title: "Offers", blurb: "How riders are asked." },
  { id: "search-area", title: "Search area", blurb: "How far from the store we look, and how that widens." },
  { id: "timing", title: "Timing", blurb: "When the search starts for food that is still being prepared, and how travel time is estimated." },
  { id: "location", title: "Location", blurb: "Which rider locations we trust." },
  { id: "store-alerts", title: "Store alerts", blurb: "When a store is told there is no rider near." },
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

/** Map grid level -> the words used in the UI. Level 8 is the default. */
const LEVEL_NAME: Readonly<Record<number, string>> = { 7: "Large", 8: "Medium", 9: "Small" };
/** Roughly how wide one block is at each level, in km (flat side to flat side, rounded). */
const BLOCK_WIDTH_KM: Readonly<Record<number, number>> = { 7: 2.1, 8: 0.8, 9: 0.3 };

function blocksText(count: number): string {
  return count === 1 ? "1 block" : `${count} blocks`;
}

/** "roughly 2.4 km" for N blocks out at the given level, or null for an unknown level. */
function blocksReach(count: number, level: number): string | null {
  const width = BLOCK_WIDTH_KM[level];
  return width === undefined ? null : `roughly ${Number((count * width).toFixed(1))} km`;
}

/** How a stored value reads on the page. */
export function formatDispatchValue(key: DispatchSettingKey, value: number): string {
  const info = DISPATCH_SETTING_INFO[key];
  if (key === "dispatch_radius_m" && value === 0) return "No limit";
  if (key === "dispatch_notify_vendor_after_seconds" && value === 0) return "Straight away";
  switch (info.unit) {
    case "km":
      return formatKm(value);
    case "minutes":
    case "seconds":
      return formatSeconds(value);
    case "metres":
      return `${value} m`;
    case "riders":
      return value === 1 ? "1 rider" : `${value} riders`;
    case "deliveries":
      return value === 1 ? "1 delivery" : `${value} deliveries`;
    case "blocks":
      return blocksText(value);
    case "level":
      return LEVEL_NAME[value] ? `${LEVEL_NAME[value]} (level ${value})` : `Level ${value}`;
    case "kmh":
      return `${value} km/h`;
    case "pct":
      return `${value}%`;
  }
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
  if (info.unit !== "km" && info.unit !== "minutes") return /^\d{1,4}$/.test(text) ? Number(text) : null;
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

/**
 * The first search cannot reach further than the furthest search. The database
 * enforces this on either change; this gives the same answer before saving.
 */
export function dispatchRingOrderError(key: DispatchSettingKey, value: number, ctx: DispatchSettingsValues): string | null {
  if (key === "dispatch_h3_initial_ring" && value > ctx.maxRing) {
    return `The first search can't reach further than the furthest search, which is ${blocksText(ctx.maxRing)} now. Raise the furthest search first, or choose ${ctx.maxRing} or fewer.`;
  }
  if (key === "dispatch_h3_max_ring" && value < ctx.initialRing) {
    return `The furthest search can't be smaller than the first search, which is ${blocksText(ctx.initialRing)} now. Lower the first search first, or choose ${ctx.initialRing} or more.`;
  }
  return null;
}

/** The example distance used in the "would a rider this far be offered the order" sentence. */
const EXAMPLE_RIDER_M = 8500;

/** One-sentence "what this means" for a (current or proposed) value. */
export function dispatchPreview(key: DispatchSettingKey, value: number, ctx: DispatchSettingsValues): string {
  switch (key) {
    case "dispatch_offer_timeout_seconds":
      return `Each rider has ${formatSeconds(value)} to answer. If they decline, or the time runs out, the next rider is asked straight away.`;
    case "dispatch_max_riders":
      return `A round asks up to ${formatDispatchValue(key, value)}, one at a time. If none accept, a new round starts; after two full rounds with no one accepting, the order is flagged for your attention.`;
    case "dispatch_radius_m": {
      if (value === 0) return "There is no distance limit: any online rider can be asked about a new order, however far from the store.";
      const verdict = EXAMPLE_RIDER_M <= value ? "can be asked" : "cannot be asked";
      return `We look for riders within ${formatKm(value)} of the store. A rider ${formatKm(EXAMPLE_RIDER_M)} away ${verdict} about a new order (until the search widens).`;
    }
    case "dispatch_widen_after_seconds":
      if (value === 0) return "We never search further on our own: if nobody within the first distance accepts, the order waits until someone steps in.";
      if (ctx.radiusM === 0) return `This does nothing yet: with no first search distance there is nothing to widen. Once you set a distance, after ${formatSeconds(value)} the search widens to the store's own delivery distance.`;
      return `If nobody has accepted after ${formatSeconds(value)}, we look as far as the store's own delivery distance (each store sets its own, for example 20 km).`;
    case "dispatch_h3_resolution": {
      const name = LEVEL_NAME[value];
      const width = BLOCK_WIDTH_KM[value];
      return name && width ? `${name} blocks are roughly ${width} km across. The "nearby blocks" settings count blocks of this size, so change them together.` : "Choose 7, 8 or 9.";
    }
    case "dispatch_h3_initial_ring": {
      if (value === 0) return "The first search looks only in the store's own block.";
      const reach = blocksReach(value, ctx.h3Resolution);
      return `The first search looks in the store's own block and ${blocksText(value)} around it${reach ? `, ${reach} from the store at the current block size` : ""}.`;
    }
    case "dispatch_h3_max_ring": {
      const reach = blocksReach(value, ctx.h3Resolution);
      return `If nobody accepts, the search keeps widening up to ${blocksText(value)} around the store${reach ? ` (${reach})` : ""}, then falls back to the nearest riders overall.`;
    }
    case "dispatch_secure_buffer_seconds":
      return `For food still being prepared, the search starts about ${formatSeconds(value)} before a rider needs to be on the way, until the system has learned a better figure.`;
    case "dispatch_default_travel_seconds":
      return `When we cannot work out how far riders are, we assume a rider needs ${formatSeconds(value)} to reach the store.`;
    case "dispatch_default_speed_kmh":
      return `Riders are assumed to average ${value} km/h until enough deliveries show the real speed.`;
    case "dispatch_road_factor_pct":
      return `A 1 km straight line on the map counts as ${Number((value / 100).toFixed(2))} km of road.`;
    case "dispatch_min_history_samples":
      return `An area's speed and search time are learned only after ${formatDispatchValue(key, value)}; until then the defaults are used.`;
    case "dispatch_vendor_arrival_radius_m":
      return `A rider counts as at the store once they are within ${value} m of it.`;
    case "dispatch_location_max_age_seconds":
      return `Riders whose phone has not reported a location in the last ${formatSeconds(value)} are not asked about orders.`;
    case "dispatch_notify_vendor_after_seconds":
      return value === 0
        ? "The store is told straight away when no rider is in range, and can ask us to look further away or deliver the order itself."
        : `If no rider is in range after ${formatSeconds(value)}, the store is told, and can ask us to look further away or deliver the order itself.`;
  }
}

/** The single sentence under the edit box: what is wrong with what is typed, or what saving would mean. */
export function dispatchPreviewFor(info: DispatchSettingInfo, typed: string, current: DispatchSettingsValues): { text: string; problem: boolean } {
  const value = parseDispatchInput(info.key, typed);
  if (value === null) {
    const whole = info.unit !== "km" && info.unit !== "minutes";
    return { text: whole ? "Enter a whole number, for example 5." : "Enter a plain number, for example 5 or 7.5.", problem: true };
  }
  const problem = dispatchRangeError(info.key, value) ?? dispatchRingOrderError(info.key, value, current);
  if (problem) return { text: problem, problem: true };

  const next: DispatchSettingsValues = { ...current, [DISPATCH_VALUE_FIELD[info.key]]: value };
  return { text: `If you save: ${dispatchPreview(info.key, value, next)}`, problem: false };
}
