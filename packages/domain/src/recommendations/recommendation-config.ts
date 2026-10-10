/**
 * The ONE place the Phase 1 recommender's tunable numbers live.
 *
 * Every weight/cap below is a PLACEHOLDER taken from the product spec's
 * illustrative values - they are starting points to be tuned against real
 * behaviour, not derived constants. Change them here (and only here); the
 * scoring code in ./rank-recommendations.ts reads nothing else.
 */

export type DaypartKey = "breakfast" | "lunch" | "afternoon" | "evening" | "late_night";

export interface DaypartRange {
  readonly key: DaypartKey;
  /** Inclusive start hour, local (Africa/Lagos) time, 0-23. */
  readonly startHour: number;
  /** Exclusive end hour, 0-24. startHour > endHour means the range wraps midnight. */
  readonly endHour: number;
}

export interface RecommendationConfig {
  /** Signals older than this are ignored entirely. */
  readonly lookbackDays: number;
  /** A signal's weight halves every this-many days (exponential decay). */
  readonly recencyHalfLifeDays: number;
  /** Events younger than this feed `recentBehavior`; older ones feed `personalPreference`. */
  readonly recentWindowDays: number;

  /** Raw points a single signal contributes before decay and before squashing into a score cap. */
  readonly actionWeights: {
    /** First order of a given menu item. */
    readonly ordered: number;
    /** Second-or-later order of the same menu item (stronger than `ordered`). */
    readonly reordered: number;
    readonly cartAdd: number;
    /** A search whose normalised text is contained in the item's / vendor's name. */
    readonly search: number;
    readonly viewItem: number;
    /**
     * view_vendor. The product spec gives one "view" weight; a vendor view is
     * a weaker, less specific signal than viewing a dish, so it counts at
     * half the item-view weight and is applied at VENDOR level - it flows to
     * every item of that vendor through `restaurantPreference` (it never
     * makes an individual dish "familiar").
     */
    readonly viewVendor: number;
    /** order_ratings.vendor_rating >= positiveRatingMin: applied to the vendor and the items of that order. */
    readonly positiveRating: number;
    /** Items of a cancelled_by_customer order (negative). */
    readonly cancelled: number;
    /** Spec gives no weight for removing from cart. Left at 0 on purpose; kept so it can be tuned. */
    readonly cartRemove: number;
    /** Measurement only (did the recommendation work?) - must not feed back into ranking. */
    readonly recommendationClick: number;
  };
  readonly positiveRatingMin: number;

  /** Orders in these statuses never happened (or never reached the kitchen): ignored. */
  readonly ignoredOrderStatuses: readonly string[];
  /** Orders in these statuses apply `actionWeights.cancelled` to their items. */
  readonly cancelledStatuses: readonly string[];

  /** Max points each score component can contribute (spec's illustrative values). */
  readonly scoreCaps: {
    readonly personalPreference: number;
    readonly recentBehavior: number;
    readonly timePreference: number;
    readonly restaurantPreference: number;
    /** Phase 2 (needs cross-customer aggregates): reserved, ignored by the Phase 1 engine. */
    readonly localPopularity: number;
    /** Phase 2 (needs cross-customer aggregates): reserved, ignored by the Phase 1 engine. */
    readonly similarCustomers: number;
    readonly priceFit: number;
    /** Subtracted (max) for the farthest candidates. */
    readonly distancePenalty: number;
    /** Subtracted from a candidate explicitly flagged unavailable. Candidates are pre-filtered, so normally never applied. */
    readonly availabilityPenalty: number;
    /** Public vendor-rating points; used only for the explore bucket and cold start. */
    readonly vendorQuality: number;
  };

  /**
   * A raw (decayed) weight sum maps to points as `cap * raw / (|raw| + k)`:
   * monotonic, sign-preserving, never exceeds `cap`. `k` is the raw sum that
   * earns half the cap.
   */
  readonly saturation: {
    readonly personalPreference: number;
    readonly recentBehavior: number;
    readonly timePreference: number;
    readonly restaurantPreference: number;
  };
  /** How much a category's (not the item's own) affinity counts toward personalPreference. */
  readonly categoryAffinityFactor: number;

  readonly time: {
    readonly timeZone: string;
    /** Africa/Lagos is a fixed UTC+1 (no DST), so no Intl/tz database is needed. */
    readonly utcOffsetHours: number;
    readonly dayparts: readonly DaypartRange[];
    /** Multiplier when the past order was also on the same day of the week (Fri evening, Sun afternoon...). */
    readonly sameDayBonus: number;
    /** Weight of "this category was ordered at this time" relative to "this item was". */
    readonly categoryFactor: number;
  };

  readonly price: {
    /** Below this many ordered-item price samples the range is a +-band around the median. */
    readonly minSamples: number;
    /** Half-width of that band, as a fraction of the median. */
    readonly singleSampleBand: number;
    /** Points reach zero when a price is this fraction of the range edge away from it. */
    readonly outsideDecayRatio: number;
  };

  readonly distance: {
    /** Distance at which the penalty reaches its cap; linear below it. 0 when distance is unknown. */
    readonly scaleM: number;
  };

  readonly quality: {
    /** Bayesian smoothing so one 5-star rating does not outrank a 4.7 from 400 orders. */
    readonly priorRating: number;
    readonly priorWeight: number;
    /** Smoothed rating at/below this earns 0 quality points ... */
    readonly floorRating: number;
    /** ... and at/above this earns the full vendorQuality cap. */
    readonly ceilingRating: number;
  };

  /**
   * A behavioural component must earn at least this many points to label a
   * result; below it the reason falls back to price fit (or "something new").
   */
  readonly reasonMinPoints: number;

  readonly mix: {
    /** Number of recommendation slots. */
    readonly total: number;
    /**
     * Target shares of `total`. Mapping to whole slots (see slotQuotas()):
     * explore = ceil(explore * total), similar = round(similar * total),
     * familiar = the rest. With 5 slots: 0.1 -> 1, 0.2 -> 1, familiar = 3
     * (3 familiar / 1 similar / 1 explore). A short bucket's unused slots
     * are backfilled from the remaining candidates in familiar -> similar
     * -> explore order.
     */
    readonly familiar: number;
    readonly similar: number;
    readonly explore: number;
    /** Variety guard: never more than this many results from one vendor. */
    readonly maxPerVendor: number;
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export const RECOMMENDATION_CONFIG: RecommendationConfig = deepFreeze({
  lookbackDays: 180,
  recencyHalfLifeDays: 30,
  recentWindowDays: 14,

  actionWeights: {
    ordered: 10,
    reordered: 15,
    cartAdd: 7,
    search: 4,
    viewItem: 2,
    viewVendor: 1,
    positiveRating: 8,
    cancelled: -5,
    cartRemove: 0,
    recommendationClick: 0,
  },
  positiveRatingMin: 4,

  ignoredOrderStatuses: ["draft", "rejected_by_vendor", "cancelled_by_platform"],
  cancelledStatuses: ["cancelled_by_customer"],

  scoreCaps: {
    personalPreference: 40,
    recentBehavior: 20,
    timePreference: 15,
    restaurantPreference: 10,
    localPopularity: 0,
    similarCustomers: 0,
    priceFit: 7,
    distancePenalty: 5,
    availabilityPenalty: 10,
    vendorQuality: 10,
  },

  saturation: {
    personalPreference: 15,
    recentBehavior: 8,
    timePreference: 8,
    restaurantPreference: 12,
  },
  categoryAffinityFactor: 0.3,

  time: {
    timeZone: "Africa/Lagos",
    utcOffsetHours: 1,
    dayparts: [
      { key: "breakfast", startHour: 6, endHour: 11 },
      { key: "lunch", startHour: 11, endHour: 15 },
      { key: "afternoon", startHour: 15, endHour: 18 },
      { key: "evening", startHour: 18, endHour: 22 }, // "evening / dinner"
      { key: "late_night", startHour: 22, endHour: 6 }, // wraps midnight
    ],
    sameDayBonus: 1.5,
    categoryFactor: 0.5,
  },

  price: {
    minSamples: 3,
    singleSampleBand: 0.3,
    outsideDecayRatio: 1,
  },

  distance: {
    scaleM: 5000,
  },

  quality: {
    priorRating: 4,
    priorWeight: 5,
    floorRating: 3,
    ceilingRating: 5,
  },

  reasonMinPoints: 1,

  mix: {
    total: 5,
    familiar: 0.7,
    similar: 0.2,
    explore: 0.1,
    maxPerVendor: 2,
  },
});
