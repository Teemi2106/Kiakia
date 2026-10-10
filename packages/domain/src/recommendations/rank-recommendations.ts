/**
 * Phase 1 "recommended for you" ranking engine.
 *
 * Pure and deterministic: no I/O, no Math.random, no Date.now() (the caller
 * passes `now`). It only ever uses (a) the customer's OWN orders, ratings
 * and events and (b) public catalogue data on the candidates - never another
 * customer's behaviour, so a reason string can never leak anyone else.
 *
 * The caller (apps/web's getHomeRecommendations) is responsible for
 * FILTERING BEFORE RANKING: every candidate handed in is already an
 * available item from an active, open, in-range vendor. Nothing here
 * re-checks that (except the optional `unavailable` flag's penalty).
 *
 * All tunable numbers live in ./recommendation-config.ts.
 */

import { MEAL_CATEGORIES } from "../meal-categories";
import { koboOf, type Kobo } from "../money";
import {
  RECOMMENDATION_CONFIG,
  type DaypartKey,
  type RecommendationConfig,
} from "./recommendation-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecommendationBucket = "familiar" | "similar" | "explore";

export type RecommendationReasonCode =
  | "ordered_recently"
  | "ordered_before"
  | "viewed_before"
  | "category_preference"
  | "recent_cart"
  | "recent_view"
  | "recent_search"
  | "usual_time"
  | "usual_restaurant"
  | "price_fit"
  | "explore_new"
  | "top_rated";

export interface RecOrderItem {
  readonly menuItemId: string;
  readonly unitPriceKobo: number;
  /** menu_categories.category_key of the item, when known (falls back to the candidate list). */
  readonly categoryKey?: string | null;
}

/** One of the customer's own past orders. */
export interface RecOrder {
  readonly vendorId: string;
  /** orders.status */
  readonly status: string;
  /** ISO timestamp (orders.placed_at, or created_at when never placed). */
  readonly placedAt: string;
  readonly items: readonly RecOrderItem[];
  /** order_ratings.vendor_rating (1-5) when the customer rated this order. */
  readonly vendorRating?: number | null;
}

/** One of the customer's own customer_events rows. */
export interface RecEvent {
  readonly eventType: string;
  readonly vendorId?: string | null;
  readonly menuItemId?: string | null;
  readonly categoryKey?: string | null;
  readonly searchQuery?: string | null;
  /** ISO timestamp */
  readonly createdAt: string;
}

/** An already-filtered (available / active / open / in-range) menu item. */
export interface RecCandidate {
  readonly menuItemId: string;
  readonly name: string;
  readonly vendorId: string;
  readonly vendorName: string;
  readonly vendorSlug: string;
  readonly categoryKey: string | null;
  readonly priceKobo: number;
  readonly imageUrl: string | null;
  readonly prepMins: number | null;
  /** Metres from the customer's default address; null when either side's coordinates are unknown. */
  readonly distanceM: number | null;
  readonly vendorRatingAvg: number;
  readonly vendorRatingCount: number;
  /** Defensive: set true to apply availabilityPenalty. Callers normally pre-filter instead. */
  readonly unavailable?: boolean;
}

export interface RankRecommendationsInput {
  readonly orders: readonly RecOrder[];
  readonly events: readonly RecEvent[];
  readonly candidates: readonly RecCandidate[];
  readonly now: Date;
  /** Test seam; defaults to RECOMMENDATION_CONFIG. */
  readonly config?: RecommendationConfig;
}

export interface RecommendedItem {
  readonly menuItemId: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly priceKobo: Kobo;
  readonly vendorId: string;
  readonly vendorName: string;
  readonly vendorSlug: string;
  readonly prepMins: number | null;
  readonly score: number;
  readonly bucket: RecommendationBucket;
  readonly reasonCode: RecommendationReasonCode;
  readonly reason: string;
}

export interface RecommendationResult {
  /**
   * false for the cold-start / no-personal-signal result: the UI should label
   * it honestly (e.g. "Top rated near you") rather than "Recommended for you".
   */
  readonly personalised: boolean;
  readonly items: readonly RecommendedItem[];
}

// ---------------------------------------------------------------------------
// Small pure helpers (exported for tests)
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** Exponential recency decay: 1 now, 0.5 after one half-life. Future timestamps clamp to 1. */
export function decayFactor(ageMs: number, halfLifeDays: number): number {
  const ageDays = Math.max(0, ageMs) / MS_PER_DAY;
  return 0.5 ** (ageDays / halfLifeDays);
}

export interface LagosParts {
  /** 0-23 */
  readonly hour: number;
  /** 0 = Sunday .. 6 = Saturday */
  readonly dayOfWeek: number;
  readonly daypart: DaypartKey;
}

export function daypartOf(hour: number, config: RecommendationConfig = RECOMMENDATION_CONFIG): DaypartKey {
  for (const range of config.time.dayparts) {
    const wraps = range.startHour > range.endHour;
    const inRange = wraps
      ? hour >= range.startHour || hour < range.endHour
      : hour >= range.startHour && hour < range.endHour;
    if (inRange) return range.key;
  }
  // Config gap: fall back to the last range rather than throwing in a render path.
  return config.time.dayparts[config.time.dayparts.length - 1]!.key;
}

/** Wall-clock hour/day-of-week/daypart in Africa/Lagos (fixed UTC+1, no DST). */
export function lagosParts(date: Date, config: RecommendationConfig = RECOMMENDATION_CONFIG): LagosParts {
  const shifted = new Date(date.getTime() + config.time.utcOffsetHours * 3_600_000);
  const hour = shifted.getUTCHours();
  return { hour, dayOfWeek: shifted.getUTCDay(), daypart: daypartOf(hour, config) };
}

/** trim, lower-case, collapse whitespace - same rules log_customer_event() applies in SQL. */
export function normaliseQuery(raw: string | null | undefined): string {
  return (raw ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80).trim();
}

/** cap * raw / (|raw| + k): sign-preserving, monotonic, bounded by cap. */
function squash(raw: number, cap: number, k: number): number {
  if (raw === 0 || cap === 0) return 0;
  return (cap * raw) / (Math.abs(raw) + k);
}

function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  const lo = sorted[lower]!;
  const hi = sorted[upper]!;
  return lo + (hi - lo) * (pos - lower);
}

export interface PriceRange {
  readonly low: number;
  readonly high: number;
}

/**
 * The customer's typical item spend: interquartile range of the unit prices
 * they have ordered. With fewer than `minSamples` prices there is no
 * meaningful IQR, so it is a +-band around the median; with none, null.
 */
export function typicalPriceRange(
  pricesKobo: readonly number[],
  config: RecommendationConfig = RECOMMENDATION_CONFIG,
): PriceRange | null {
  if (pricesKobo.length === 0) return null;
  const sorted = [...pricesKobo].sort((a, b) => a - b);
  if (sorted.length < config.price.minSamples) {
    const median = quantile(sorted, 0.5);
    return { low: median * (1 - config.price.singleSampleBand), high: median * (1 + config.price.singleSampleBand) };
  }
  return { low: quantile(sorted, 0.25), high: quantile(sorted, 0.75) };
}

/** Full cap inside [low, high]; decays linearly with relative distance outside it. */
export function priceFitPoints(
  priceKobo: number,
  range: PriceRange | null,
  config: RecommendationConfig = RECOMMENDATION_CONFIG,
): number {
  const cap = config.scoreCaps.priceFit;
  if (!range || cap === 0) return 0;
  if (priceKobo >= range.low && priceKobo <= range.high) return cap;
  const edge = priceKobo < range.low ? range.low : range.high;
  const ratio = edge > 0 ? Math.abs(priceKobo - edge) / edge : 1;
  return cap * Math.max(0, 1 - ratio / config.price.outsideDecayRatio);
}

/** Distance penalty: 0 when unknown, linear up to `scaleM`, capped. */
export function distancePenaltyPoints(
  distanceM: number | null,
  config: RecommendationConfig = RECOMMENDATION_CONFIG,
): number {
  if (distanceM === null || !Number.isFinite(distanceM)) return 0;
  return config.scoreCaps.distancePenalty * Math.min(1, Math.max(0, distanceM) / config.distance.scaleM);
}

/** Public vendor-rating points, Bayesian-smoothed toward a prior for thin review counts. */
export function qualityPoints(
  ratingAvg: number,
  ratingCount: number,
  config: RecommendationConfig = RECOMMENDATION_CONFIG,
): number {
  const { priorRating, priorWeight, floorRating, ceilingRating } = config.quality;
  const count = Math.max(0, ratingCount);
  const avg = count > 0 ? ratingAvg : 0;
  const smoothed = (avg * count + priorRating * priorWeight) / (count + priorWeight);
  const t = (smoothed - floorRating) / (ceilingRating - floorRating);
  return config.scoreCaps.vendorQuality * Math.min(1, Math.max(0, t));
}

/**
 * Maps the mix fractions onto whole slots. explore rounds UP (a non-zero
 * explore share always gets a slot, which is what keeps discovery alive on a
 * 5-slot row), similar rounds to nearest, familiar takes the rest:
 * 5 slots @ 0.7/0.2/0.1 -> 3 / 1 / 1.
 */
export function slotQuotas(mix: RecommendationConfig["mix"]): Record<RecommendationBucket, number> {
  const explore = mix.explore > 0 ? Math.min(mix.total, Math.ceil(mix.explore * mix.total - 1e-9)) : 0;
  const similar = Math.min(mix.total - explore, Math.round(mix.similar * mix.total));
  const familiar = Math.max(0, mix.total - explore - similar);
  return { familiar, similar, explore };
}

function categoryLabel(key: string): string {
  const preset = MEAL_CATEGORIES.find((c) => c.key === key);
  if (preset) return preset.label;
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Signal accumulation
// ---------------------------------------------------------------------------

interface ItemAcc {
  /** Decayed order/reorder/rating/cancel weight + events older than the recent window. */
  personal: number;
  /** Decayed cart/view weight from events inside the recent window. */
  recent: number;
  recentCart: number;
  recentView: number;
  /** Raw weight that came from past orders (positive only), to word the reason. */
  orderedRaw: number;
  interacted: boolean;
  lastOrderedMs: number | null;
  /** Time-of-day affinity (decayed, same-daypart orders). */
  time: number;
}

interface SearchSignal {
  readonly query: string;
  readonly decay: number;
  readonly recent: boolean;
}

function newItemAcc(): ItemAcc {
  return {
    personal: 0,
    recent: 0,
    recentCart: 0,
    recentView: 0,
    orderedRaw: 0,
    interacted: false,
    lastOrderedMs: null,
    time: 0,
  };
}

interface Signals {
  readonly items: Map<string, ItemAcc>;
  readonly categories: Map<string, { personal: number; time: number }>;
  readonly vendors: Map<string, number>;
  readonly searches: SearchSignal[];
  readonly pricesKobo: number[];
  /** Number of in-lookback, non-ignored signals that were counted. */
  signalCount: number;
}

function accumulateSignals(
  input: RankRecommendationsInput,
  cfg: RecommendationConfig,
  categoryByItem: ReadonlyMap<string, string | null>,
): Signals {
  const nowMs = input.now.getTime();
  const lookbackMs = cfg.lookbackDays * MS_PER_DAY;
  const recentMs = cfg.recentWindowDays * MS_PER_DAY;
  const w = cfg.actionWeights;
  const nowParts = lagosParts(input.now, cfg);

  const signals: Signals = {
    items: new Map(),
    categories: new Map(),
    vendors: new Map(),
    searches: [],
    pricesKobo: [],
    signalCount: 0,
  };

  const itemAcc = (id: string): ItemAcc => {
    let acc = signals.items.get(id);
    if (!acc) {
      acc = newItemAcc();
      signals.items.set(id, acc);
    }
    return acc;
  };
  const catAcc = (key: string) => {
    let acc = signals.categories.get(key);
    if (!acc) {
      acc = { personal: 0, time: 0 };
      signals.categories.set(key, acc);
    }
    return acc;
  };
  const addVendor = (id: string, amount: number) =>
    signals.vendors.set(id, (signals.vendors.get(id) ?? 0) + amount);
  const categoryOf = (itemId: string, explicit?: string | null): string | null =>
    explicit ?? categoryByItem.get(itemId) ?? null;

  // Orders, oldest first, so "first order" vs "reorder" of an item is by time.
  const orders = input.orders
    .map((order, index) => ({ order, index, ms: Date.parse(order.placedAt) }))
    .filter((o) => Number.isFinite(o.ms) && nowMs - o.ms <= lookbackMs)
    .sort((a, b) => a.ms - b.ms || a.index - b.index);

  const timesOrdered = new Map<string, number>();

  for (const { order, ms } of orders) {
    if (cfg.ignoredOrderStatuses.includes(order.status)) continue;
    const decay = decayFactor(nowMs - ms, cfg.recencyHalfLifeDays);
    const uniqueItems = [...new Map(order.items.map((item) => [item.menuItemId, item])).values()];
    signals.signalCount += 1;

    if (cfg.cancelledStatuses.includes(order.status)) {
      for (const item of uniqueItems) {
        const acc = itemAcc(item.menuItemId);
        acc.personal += w.cancelled * decay;
        acc.interacted = true;
      }
      continue;
    }

    const positivelyRated =
      order.vendorRating !== null &&
      order.vendorRating !== undefined &&
      order.vendorRating >= cfg.positiveRatingMin;
    const ratingBoost = positivelyRated ? w.positiveRating : 0;
    const parts = lagosParts(new Date(ms), cfg);
    const timeMatch =
      parts.daypart === nowParts.daypart
        ? decay * (parts.dayOfWeek === nowParts.dayOfWeek ? cfg.time.sameDayBonus : 1)
        : 0;

    addVendor(order.vendorId, (w.ordered + ratingBoost) * decay);

    for (const item of uniqueItems) {
      const seen = timesOrdered.get(item.menuItemId) ?? 0;
      timesOrdered.set(item.menuItemId, seen + 1);
      const weight = (seen === 0 ? w.ordered : w.reordered) + ratingBoost;

      const acc = itemAcc(item.menuItemId);
      acc.personal += weight * decay;
      acc.orderedRaw += weight * decay;
      acc.interacted = true;
      acc.lastOrderedMs = ms;
      acc.time += timeMatch;

      const category = categoryOf(item.menuItemId, item.categoryKey);
      if (category) {
        const cat = catAcc(category);
        cat.personal += weight * decay;
        cat.time += timeMatch;
      }
      signals.pricesKobo.push(item.unitPriceKobo);
    }
  }

  for (const event of input.events) {
    const ms = Date.parse(event.createdAt);
    if (!Number.isFinite(ms) || nowMs - ms > lookbackMs) continue;
    const decay = decayFactor(nowMs - ms, cfg.recencyHalfLifeDays);
    const isRecent = nowMs - ms <= recentMs;

    if (event.eventType === "search") {
      const query = normaliseQuery(event.searchQuery);
      if (query && w.search !== 0) {
        signals.searches.push({ query, decay, recent: isRecent });
        signals.signalCount += 1;
      }
      continue;
    }

    if (event.eventType === "view_vendor") {
      if (event.vendorId && w.viewVendor !== 0) {
        addVendor(event.vendorId, w.viewVendor * decay);
        signals.signalCount += 1;
      }
      continue;
    }

    const weight =
      event.eventType === "view_item"
        ? w.viewItem
        : event.eventType === "cart_add"
          ? w.cartAdd
          : event.eventType === "cart_remove"
            ? w.cartRemove
            : event.eventType === "recommendation_click"
              ? w.recommendationClick
              : 0;
    if (weight === 0 || !event.menuItemId) continue;

    signals.signalCount += 1;
    const acc = itemAcc(event.menuItemId);
    acc.interacted = true;
    if (isRecent) {
      acc.recent += weight * decay;
      if (event.eventType === "cart_add") acc.recentCart += weight * decay;
      else acc.recentView += weight * decay;
    } else {
      acc.personal += weight * decay;
    }

    const category = categoryOf(event.menuItemId, event.categoryKey);
    if (category) catAcc(category).personal += weight * decay;
    if (event.eventType === "cart_add" && event.vendorId) addVendor(event.vendorId, weight * decay);
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface Scored {
  readonly candidate: RecCandidate;
  readonly bucket: RecommendationBucket;
  readonly score: number;
  readonly reasonCode: RecommendationReasonCode;
  readonly reason: string;
}

function compareScored(a: Scored, b: Scored): number {
  return (
    b.score - a.score ||
    a.candidate.priceKobo - b.candidate.priceKobo ||
    (a.candidate.menuItemId < b.candidate.menuItemId ? -1 : a.candidate.menuItemId > b.candidate.menuItemId ? 1 : 0)
  );
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function scoreCandidates(
  candidates: readonly RecCandidate[],
  signals: Signals,
  cfg: RecommendationConfig,
  coldStart: boolean,
  nowMs: number,
): Scored[] {
  const caps = cfg.scoreCaps;
  const range = typicalPriceRange(signals.pricesKobo, cfg);
  const w = cfg.actionWeights;

  return candidates.map((candidate): Scored => {
    const item = signals.items.get(candidate.menuItemId);
    const cat = candidate.categoryKey ? signals.categories.get(candidate.categoryKey) : undefined;
    const name = candidate.name.toLowerCase();
    const vendorName = candidate.vendorName.toLowerCase();

    // Searches: item-name match feeds the item, vendor-name match feeds the vendor.
    let searchRecent = 0;
    let searchPersonal = 0;
    let vendorSearch = 0;
    for (const search of signals.searches) {
      if (name.includes(search.query)) {
        if (search.recent) searchRecent += w.search * search.decay;
        else searchPersonal += w.search * search.decay;
      }
      if (vendorName.includes(search.query)) vendorSearch += w.search * search.decay;
    }

    const itemPersonal = item?.personal ?? 0;
    const itemRecent = item?.recent ?? 0;
    const categoryPersonal = cat?.personal ?? 0;
    const vendorRaw = (signals.vendors.get(candidate.vendorId) ?? 0) + vendorSearch;

    const personalRaw = itemPersonal + searchPersonal + cfg.categoryAffinityFactor * categoryPersonal;
    const recentRaw = itemRecent + searchRecent;
    const timeRaw = (item?.time ?? 0) + cfg.time.categoryFactor * (cat?.time ?? 0);

    const personal = squash(personalRaw, caps.personalPreference, cfg.saturation.personalPreference);
    const recent = squash(recentRaw, caps.recentBehavior, cfg.saturation.recentBehavior);
    const time = squash(timeRaw, caps.timePreference, cfg.saturation.timePreference);
    const restaurant = squash(vendorRaw, caps.restaurantPreference, cfg.saturation.restaurantPreference);
    const price = priceFitPoints(candidate.priceKobo, range, cfg);

    const familiar = Boolean(item?.interacted) && itemPersonal + itemRecent > 0;
    const bucket: RecommendationBucket = coldStart
      ? "explore"
      : familiar
        ? "familiar"
        : categoryPersonal > 0 || vendorRaw > 0
          ? "similar"
          : "explore";

    // Public vendor rating only ranks the "new to you" candidates; for
    // familiar/similar items the customer's own history is the signal.
    const quality =
      bucket === "explore" ? qualityPoints(candidate.vendorRatingAvg, candidate.vendorRatingCount, cfg) : 0;

    const distance = distancePenaltyPoints(candidate.distanceM, cfg);
    const availability = candidate.unavailable ? caps.availabilityPenalty : 0;
    // localPopularity / similarCustomers: Phase 2 (cross-customer aggregates), intentionally absent.

    const score = round3(personal + recent + time + restaurant + price + quality - distance - availability);

    // ---- reason: the dominant BEHAVIOURAL component (the customer's own
    // data only). Listed in tie-break priority order - earlier wins a tie.
    // Price fit and public rating are weak, near-universal signals, so they
    // only label a result when no behavioural component is strong enough
    // (>= reasonMinPoints), and price never labels an explore item.
    const components: Array<{ code: RecommendationReasonCode; points: number }> = [
      { code: "ordered_before", points: personal }, // refined below
      { code: "recent_view", points: recent }, // refined below
      { code: "usual_time", points: time },
      { code: "usual_restaurant", points: restaurant },
    ];
    let best = components[0]!;
    for (const component of components) {
      if (component.points > best.points) best = component;
    }
    const strong = best.points >= cfg.reasonMinPoints;
    const usePriceFit = !strong && bucket !== "explore" && price > 0;
    const useWeakBest = !strong && !usePriceFit && bucket !== "explore" && best.points > 0;

    let reasonCode: RecommendationReasonCode = "explore_new";
    let reason = "Something new to try";

    if (coldStart) {
      reasonCode = "top_rated";
      reason = candidate.distanceM !== null ? "Top rated near you" : "Top rated on KiaKia";
    } else if (usePriceFit) {
      reasonCode = "price_fit";
      reason = "Fits your usual spending range";
    } else if (strong || useWeakBest) {
      switch (best.code) {
        case "ordered_before": {
          if ((item?.orderedRaw ?? 0) > 0 && item?.lastOrderedMs != null) {
            const recently = nowMs - item.lastOrderedMs <= cfg.recentWindowDays * MS_PER_DAY;
            reasonCode = recently ? "ordered_recently" : "ordered_before";
            reason = recently
              ? `Because you ordered ${candidate.name} recently`
              : `Because you ordered ${candidate.name} before`;
          } else if (itemPersonal > 0) {
            reasonCode = "viewed_before";
            reason = `Because you looked at ${candidate.name} before`;
          } else if (searchPersonal > 0) {
            reasonCode = "recent_search";
            reason = "Matches something you searched for";
          } else if (candidate.categoryKey && categoryPersonal > 0) {
            reasonCode = "category_preference";
            reason = `Because you like ${categoryLabel(candidate.categoryKey)}`;
          }
          break;
        }
        case "recent_view": {
          const cart = item?.recentCart ?? 0;
          const view = item?.recentView ?? 0;
          if (searchRecent > cart && searchRecent > view) {
            reasonCode = "recent_search";
            reason = "Matches your recent search";
          } else if (cart >= view) {
            reasonCode = "recent_cart";
            reason = `Because you added ${candidate.name} to your cart recently`;
          } else {
            reasonCode = "recent_view";
            reason = `Because you viewed ${candidate.name} recently`;
          }
          break;
        }
        case "usual_time":
          reasonCode = "usual_time";
          reason = "You usually order around this time";
          break;
        case "usual_restaurant":
          reasonCode = "usual_restaurant";
          reason = "From your usual restaurant, open now";
          break;
        default:
          break;
      }
    }

    return { candidate, bucket, score, reasonCode, reason };
  });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function rankRecommendations(input: RankRecommendationsInput): RecommendationResult {
  const cfg = input.config ?? RECOMMENDATION_CONFIG;

  // Defensive normalisation: dedupe by item id, drop rows whose price isn't a
  // valid kobo amount (never throw into a render path).
  const seen = new Set<string>();
  const candidates: RecCandidate[] = [];
  for (const candidate of input.candidates) {
    if (seen.has(candidate.menuItemId)) continue;
    if (!Number.isInteger(candidate.priceKobo) || candidate.priceKobo < 0) continue;
    seen.add(candidate.menuItemId);
    candidates.push(candidate);
  }

  const categoryByItem = new Map<string, string | null>(candidates.map((c) => [c.menuItemId, c.categoryKey]));
  const signals = accumulateSignals(input, cfg, categoryByItem);

  const coldStart = signals.signalCount === 0;
  const scored = scoreCandidates(candidates, signals, cfg, coldStart, input.now.getTime());

  const buckets: Record<RecommendationBucket, Scored[]> = { familiar: [], similar: [], explore: [] };
  for (const entry of scored) buckets[entry.bucket].push(entry);
  for (const bucket of Object.values(buckets)) bucket.sort(compareScored);

  const quotas = slotQuotas(cfg.mix);
  const order: readonly RecommendationBucket[] = ["familiar", "similar", "explore"];
  const picked: Scored[] = [];
  const used = new Set<string>();
  const perVendor = new Map<string, number>();

  const take = (list: readonly Scored[], limit: number) => {
    let taken = 0;
    for (const entry of list) {
      if (taken >= limit || picked.length >= cfg.mix.total) break;
      const id = entry.candidate.menuItemId;
      const vendor = entry.candidate.vendorId;
      if (used.has(id) || (perVendor.get(vendor) ?? 0) >= cfg.mix.maxPerVendor) continue;
      used.add(id);
      perVendor.set(vendor, (perVendor.get(vendor) ?? 0) + 1);
      picked.push(entry);
      taken += 1;
    }
  };

  for (const bucket of order) take(buckets[bucket], quotas[bucket]);
  // Backfill: short buckets leave slots; fill them from what is left, in
  // familiar -> similar -> explore order.
  for (const bucket of order) take(buckets[bucket], cfg.mix.total);

  picked.sort(compareScored);

  return {
    personalised: !coldStart && picked.some((entry) => entry.bucket !== "explore"),
    items: picked.map(
      ({ candidate, bucket, score, reasonCode, reason }): RecommendedItem => ({
        menuItemId: candidate.menuItemId,
        name: candidate.name,
        imageUrl: candidate.imageUrl,
        priceKobo: koboOf(candidate.priceKobo),
        vendorId: candidate.vendorId,
        vendorName: candidate.vendorName,
        vendorSlug: candidate.vendorSlug,
        prepMins: candidate.prepMins,
        score,
        bucket,
        reasonCode,
        reason,
      }),
    ),
  };
}
