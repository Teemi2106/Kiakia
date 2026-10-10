import { describe, expect, it } from "vitest";
import {
  RECOMMENDATION_CONFIG,
  type RecommendationConfig,
} from "./recommendation-config";
import {
  daypartOf,
  decayFactor,
  distancePenaltyPoints,
  lagosParts,
  normaliseQuery,
  priceFitPoints,
  qualityPoints,
  rankRecommendations,
  slotQuotas,
  typicalPriceRange,
  type RecCandidate,
  type RecEvent,
  type RecOrder,
  type RecommendedItem,
} from "./rank-recommendations";

// Fri 2026-10-09 19:30 in Lagos (UTC+1) -> 18:30Z. Daypart "evening", day 5.
// Rating inputs that earn 0 quality points, so cross-bucket scores compare cleanly.
const QUIET = { vendorRatingAvg: 1, vendorRatingCount: 1000 } as const;
const NOW = new Date("2026-10-09T18:30:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number, from: Date = NOW) => new Date(from.getTime() - n * DAY).toISOString();

let seq = 0;
function candidate(over: Partial<RecCandidate> & { menuItemId: string }): RecCandidate {
  seq += 1;
  return {
    name: `Dish ${over.menuItemId}`,
    vendorId: `v-${over.menuItemId}`,
    vendorName: `Vendor ${over.menuItemId}`,
    vendorSlug: `vendor-${over.menuItemId}`,
    categoryKey: null,
    priceKobo: 200_000,
    imageUrl: null,
    prepMins: 20,
    distanceM: null,
    vendorRatingAvg: 4,
    vendorRatingCount: 20,
    ...over,
  };
}

function order(over: Partial<RecOrder> & { vendorId: string; items: RecOrder["items"] }): RecOrder {
  return { status: "delivered", placedAt: daysAgo(3), vendorRating: null, ...over };
}

const item = (menuItemId: string, unitPriceKobo = 200_000, categoryKey: string | null = null) => ({
  menuItemId,
  unitPriceKobo,
  categoryKey,
});

function event(over: Partial<RecEvent> & { eventType: string }): RecEvent {
  return { createdAt: daysAgo(1), ...over };
}

function byId(items: readonly RecommendedItem[], id: string): RecommendedItem {
  const found = items.find((i) => i.menuItemId === id);
  if (!found) throw new Error(`item ${id} not in result`);
  return found;
}

describe("decayFactor", () => {
  it("is 1 now, 0.5 after one half-life, 0.25 after two", () => {
    const half = RECOMMENDATION_CONFIG.recencyHalfLifeDays;
    expect(decayFactor(0, half)).toBe(1);
    expect(decayFactor(half * DAY, half)).toBeCloseTo(0.5, 10);
    expect(decayFactor(2 * half * DAY, half)).toBeCloseTo(0.25, 10);
  });

  it("clamps future timestamps to 1", () => {
    expect(decayFactor(-5 * DAY, 30)).toBe(1);
  });
});

describe("daypartOf / lagosParts", () => {
  it("maps every boundary hour to the configured daypart", () => {
    const cases: Array<[number, string]> = [
      [6, "breakfast"],
      [10, "breakfast"],
      [11, "lunch"],
      [14, "lunch"],
      [15, "afternoon"],
      [17, "afternoon"],
      [18, "evening"],
      [21, "evening"],
      [22, "late_night"],
      [23, "late_night"],
      [0, "late_night"],
      [5, "late_night"],
    ];
    for (const [hour, expected] of cases) expect(daypartOf(hour)).toBe(expected);
  });

  it("converts UTC to Africa/Lagos (UTC+1), including the midnight wrap and day rollover", () => {
    // 23:30Z Fri = 00:30 Sat Lagos -> late_night, day-of-week rolls to Saturday (6).
    expect(lagosParts(new Date("2026-10-09T23:30:00Z"))).toEqual({ hour: 0, dayOfWeek: 6, daypart: "late_night" });
    // 21:00Z = 22:00 Lagos -> late_night starts.
    expect(lagosParts(new Date("2026-10-09T21:00:00Z"))).toMatchObject({ hour: 22, daypart: "late_night" });
    // 20:59Z = 21:59 Lagos -> still evening.
    expect(lagosParts(new Date("2026-10-09T20:59:00Z"))).toMatchObject({ hour: 21, daypart: "evening" });
    // 05:00Z = 06:00 Lagos -> breakfast starts.
    expect(lagosParts(new Date("2026-10-09T05:00:00Z"))).toMatchObject({ hour: 6, daypart: "breakfast" });
    // 04:59Z = 05:59 Lagos -> still late_night.
    expect(lagosParts(new Date("2026-10-09T04:59:00Z"))).toMatchObject({ hour: 5, daypart: "late_night" });
    expect(lagosParts(NOW)).toEqual({ hour: 19, dayOfWeek: 5, daypart: "evening" });
  });
});

describe("normaliseQuery", () => {
  it("trims, lower-cases, collapses whitespace and truncates to 80", () => {
    expect(normaliseQuery("  Jollof \t RICE ")).toBe("jollof rice");
    expect(normaliseQuery(null)).toBe("");
    expect(normaliseQuery("a".repeat(100))).toHaveLength(80);
  });
});

describe("slotQuotas", () => {
  it("maps 0.7/0.2/0.1 over 5 slots to 3/1/1", () => {
    expect(slotQuotas(RECOMMENDATION_CONFIG.mix)).toEqual({ familiar: 3, similar: 1, explore: 1 });
  });

  it("always sums to total and gives a non-zero explore share a slot", () => {
    const q = slotQuotas({ ...RECOMMENDATION_CONFIG.mix, total: 10 });
    expect(q.familiar + q.similar + q.explore).toBe(10);
    expect(q.explore).toBe(1);
    expect(slotQuotas({ ...RECOMMENDATION_CONFIG.mix, explore: 0 }).explore).toBe(0);
  });
});

describe("price fit", () => {
  it("is null with no samples and a +-band around the median with few samples", () => {
    expect(typicalPriceRange([])).toBeNull();
    const r = typicalPriceRange([100_000])!;
    expect(r.low).toBeCloseTo(70_000);
    expect(r.high).toBeCloseTo(130_000);
  });

  it("uses the inter-quartile range with enough samples", () => {
    const r = typicalPriceRange([100, 200, 300, 400, 500])!;
    expect(r).toEqual({ low: 200, high: 400 });
  });

  it("gives full points inside the range and decays outside it", () => {
    const range = { low: 200_000, high: 400_000 };
    const cap = RECOMMENDATION_CONFIG.scoreCaps.priceFit;
    expect(priceFitPoints(300_000, range)).toBe(cap);
    expect(priceFitPoints(200_000, range)).toBe(cap);
    expect(priceFitPoints(400_000, range)).toBe(cap);
    const slightlyAbove = priceFitPoints(440_000, range);
    const wayAbove = priceFitPoints(700_000, range);
    expect(slightlyAbove).toBeLessThan(cap);
    expect(slightlyAbove).toBeGreaterThan(wayAbove);
    expect(priceFitPoints(800_000, range)).toBe(0); // 2x the upper edge -> ratio 1 -> 0
    expect(priceFitPoints(1_000_000, range)).toBe(0); // never negative
    expect(priceFitPoints(100_000, range)).toBeCloseTo(cap * 0.5);
  });

  it("is 0 with no range", () => {
    expect(priceFitPoints(100, null)).toBe(0);
  });
});

describe("distance penalty / quality points", () => {
  it("is 0 when unknown, linear, and capped", () => {
    const cap = RECOMMENDATION_CONFIG.scoreCaps.distancePenalty;
    const scale = RECOMMENDATION_CONFIG.distance.scaleM;
    expect(distancePenaltyPoints(null)).toBe(0);
    expect(distancePenaltyPoints(0)).toBe(0);
    expect(distancePenaltyPoints(scale / 2)).toBeCloseTo(cap / 2);
    expect(distancePenaltyPoints(scale * 10)).toBe(cap);
  });

  it("smooths thin ratings and rewards high ones", () => {
    expect(qualityPoints(5, 1)).toBeLessThan(qualityPoints(4.8, 200));
    expect(qualityPoints(0, 0)).toBeCloseTo(RECOMMENDATION_CONFIG.scoreCaps.vendorQuality * 0.5);
    expect(qualityPoints(5, 100000)).toBeLessThanOrEqual(RECOMMENDATION_CONFIG.scoreCaps.vendorQuality);
    expect(qualityPoints(1, 1000)).toBe(0);
  });
});

describe("rankRecommendations - cold start", () => {
  it("returns explore-only, non-personalised results ranked by vendor rating then price", () => {
    const result = rankRecommendations({
      orders: [],
      events: [],
      now: NOW,
      candidates: [
        candidate({ menuItemId: "low", vendorRatingAvg: 3.2, vendorRatingCount: 50 }),
        candidate({ menuItemId: "high", vendorRatingAvg: 4.9, vendorRatingCount: 50 }),
        candidate({ menuItemId: "mid-cheap", vendorRatingAvg: 4.0, vendorRatingCount: 50, priceKobo: 100_000 }),
        candidate({ menuItemId: "mid-dear", vendorRatingAvg: 4.0, vendorRatingCount: 50, priceKobo: 300_000 }),
      ],
    });
    expect(result.personalised).toBe(false);
    expect(result.items.map((i) => i.menuItemId)).toEqual(["high", "mid-cheap", "mid-dear", "low"]);
    expect(result.items.every((i) => i.bucket === "explore")).toBe(true);
    expect(result.items.every((i) => i.reasonCode === "top_rated")).toBe(true);
  });

  it("words the reason honestly depending on whether distance is known", () => {
    const near = rankRecommendations({
      orders: [],
      events: [],
      now: NOW,
      candidates: [candidate({ menuItemId: "a", distanceM: 800 })],
    });
    expect(near.items[0]!.reason).toBe("Top rated near you");
    const unknown = rankRecommendations({
      orders: [],
      events: [],
      now: NOW,
      candidates: [candidate({ menuItemId: "a" })],
    });
    expect(unknown.items[0]!.reason).toBe("Top rated on KiaKia");
  });

  it("treats only-ignored signals (draft orders, zero-weight events) as cold start", () => {
    const result = rankRecommendations({
      orders: [order({ vendorId: "v1", status: "draft", items: [item("x")] })],
      events: [
        event({ eventType: "cart_remove", menuItemId: "x" }),
        event({ eventType: "recommendation_click", menuItemId: "x" }),
      ],
      now: NOW,
      candidates: [candidate({ menuItemId: "x" })],
    });
    expect(result.personalised).toBe(false);
    expect(result.items[0]!.reasonCode).toBe("top_rated");
  });

  it("returns an empty list for no candidates", () => {
    expect(rankRecommendations({ orders: [], events: [], candidates: [], now: NOW })).toEqual({
      personalised: false,
      items: [],
    });
  });
});

describe("rankRecommendations - scoring signals", () => {
  const base = [candidate({ menuItemId: "a" }), candidate({ menuItemId: "b" })];

  it("scores a reordered item above an item ordered once", () => {
    const result = rankRecommendations({
      orders: [
        order({ vendorId: "v-a", placedAt: daysAgo(20), items: [item("a")] }),
        order({ vendorId: "v-a", placedAt: daysAgo(10), items: [item("a")] }),
        order({ vendorId: "v-b", placedAt: daysAgo(10), items: [item("b")] }),
      ],
      events: [],
      now: NOW,
      candidates: base,
    });
    expect(byId(result.items, "a").score).toBeGreaterThan(byId(result.items, "b").score);
    expect(result.items[0]!.menuItemId).toBe("a");
  });

  it("decays with age: a recent order beats an old one", () => {
    const result = rankRecommendations({
      orders: [
        order({ vendorId: "v-a", placedAt: daysAgo(100), items: [item("a")] }),
        order({ vendorId: "v-b", placedAt: daysAgo(5), items: [item("b")] }),
      ],
      events: [],
      now: NOW,
      candidates: base,
    });
    expect(byId(result.items, "b").score).toBeGreaterThan(byId(result.items, "a").score);
  });

  it("ignores signals older than the lookback window", () => {
    const result = rankRecommendations({
      orders: [order({ vendorId: "v-a", placedAt: daysAgo(181), items: [item("a")] })],
      events: [event({ eventType: "view_item", menuItemId: "b", createdAt: daysAgo(400) })],
      now: NOW,
      candidates: base,
    });
    expect(result.personalised).toBe(false);
  });

  it("scores a cancelled order's item below an untouched item", () => {
    const result = rankRecommendations({
      orders: [
        order({ vendorId: "v-a", status: "cancelled_by_customer", items: [item("a")] }),
        order({ vendorId: "v-b", items: [item("b")] }),
      ],
      events: [],
      now: NOW,
      candidates: [...base, candidate({ menuItemId: "c", vendorId: "v-c" })],
    });
    expect(byId(result.items, "a").score).toBeLessThan(byId(result.items, "c").score);
    expect(byId(result.items, "a").bucket).not.toBe("familiar");
  });

  it("ignores platform-cancelled and vendor-rejected orders entirely", () => {
    const result = rankRecommendations({
      orders: [
        order({ vendorId: "v-a", status: "cancelled_by_platform", items: [item("a")] }),
        order({ vendorId: "v-b", status: "rejected_by_vendor", items: [item("b")] }),
      ],
      events: [],
      now: NOW,
      candidates: base,
    });
    expect(result.personalised).toBe(false);
  });

  it("boosts items and vendor of a positively rated order, not a poorly rated one", () => {
    const mk = (rating: number | null) =>
      rankRecommendations({
        orders: [order({ vendorId: "v-a", vendorRating: rating, items: [item("a")] })],
        events: [],
        now: NOW,
        candidates: [candidate({ menuItemId: "a" })],
      }).items[0]!.score;
    expect(mk(5)).toBeGreaterThan(mk(null));
    expect(mk(4)).toBeGreaterThan(mk(null));
    expect(mk(3)).toBe(mk(null));
  });

  it("counts cart_add and view_item as familiar, cart_add stronger than view", () => {
    const result = rankRecommendations({
      orders: [],
      events: [
        event({ eventType: "cart_add", menuItemId: "a", vendorId: "v-a" }),
        event({ eventType: "view_item", menuItemId: "b", vendorId: "v-b" }),
      ],
      now: NOW,
      candidates: base,
    });
    expect(result.personalised).toBe(true);
    expect(byId(result.items, "a").bucket).toBe("familiar");
    expect(byId(result.items, "b").bucket).toBe("familiar");
    expect(byId(result.items, "a").score).toBeGreaterThan(byId(result.items, "b").score);
    expect(byId(result.items, "a").reasonCode).toBe("recent_cart");
    expect(byId(result.items, "b").reasonCode).toBe("recent_view");
  });

  it("gives cart_remove and recommendation_click zero weight (measurement only)", () => {
    const withNoise = rankRecommendations({
      orders: [order({ vendorId: "v-a", items: [item("a")] })],
      events: [
        event({ eventType: "cart_remove", menuItemId: "b", vendorId: "v-b" }),
        event({ eventType: "recommendation_click", menuItemId: "b", vendorId: "v-b" }),
      ],
      now: NOW,
      candidates: base,
    });
    const without = rankRecommendations({
      orders: [order({ vendorId: "v-a", items: [item("a")] })],
      events: [],
      now: NOW,
      candidates: base,
    });
    expect(withNoise).toEqual(without);
  });

  it("applies a search to items whose name contains it, and to that vendor's items by vendor name", () => {
    const result = rankRecommendations({
      orders: [],
      events: [event({ eventType: "search", searchQuery: "  JOLLOF  " })],
      now: NOW,
      candidates: [
        candidate({ menuItemId: "a", name: "Party Jollof Rice", ...QUIET }),
        candidate({ menuItemId: "b", name: "Moi Moi", ...QUIET }),
        candidate({ menuItemId: "c", name: "Plain Bread", vendorName: "Jollof Palace", ...QUIET }),
      ],
    });
    const a = byId(result.items, "a");
    const b = byId(result.items, "b");
    const c = byId(result.items, "c");
    expect(a.score).toBeGreaterThan(c.score);
    expect(c.score).toBeGreaterThan(b.score);
    expect(a.reasonCode).toBe("recent_search");
  });

  it("applies view_vendor at vendor level (all that vendor's items), weaker than viewing an item", () => {
    const result = rankRecommendations({
      orders: [],
      events: [
        event({ eventType: "view_vendor", vendorId: "shared" }),
        event({ eventType: "view_item", menuItemId: "solo", vendorId: "v-solo" }),
      ],
      now: NOW,
      candidates: [
        candidate({ menuItemId: "s1", vendorId: "shared", ...QUIET }),
        candidate({ menuItemId: "s2", vendorId: "shared", ...QUIET }),
        candidate({ menuItemId: "solo", vendorId: "v-solo", ...QUIET }),
        candidate({ menuItemId: "other", vendorId: "v-other", ...QUIET }),
      ],
    });
    expect(byId(result.items, "s1").bucket).toBe("similar");
    // Weak (< reasonMinPoints) and no price range to fall back on: the weak behavioural reason still labels it.
    expect(byId(result.items, "s1").reasonCode).toBe("usual_restaurant");
    expect(byId(result.items, "s1").score).toBeGreaterThan(byId(result.items, "other").score);
    expect(byId(result.items, "solo").score).toBeGreaterThan(byId(result.items, "s1").score);
  });

  it("prefers items ordered at the same daypart, more so on the same weekday", () => {
    const sameDayEvening = "2026-10-02T18:30:00Z"; // Fri evening Lagos, a week ago
    const otherDayEvening = "2026-10-01T18:30:00Z"; // Thu evening
    const lunch = "2026-10-02T12:00:00Z"; // Fri 13:00 Lagos
    const result = rankRecommendations({
      orders: [
        order({ vendorId: "v-a", placedAt: sameDayEvening, items: [item("a")] }),
        order({ vendorId: "v-b", placedAt: otherDayEvening, items: [item("b")] }),
        order({ vendorId: "v-c", placedAt: lunch, items: [item("c")] }),
      ],
      events: [],
      now: NOW,
      candidates: ["a", "b", "c"].map((id) => candidate({ menuItemId: id })),
    });
    const [a, b, c] = ["a", "b", "c"].map((id) => byId(result.items, id).score);
    expect(a!).toBeGreaterThan(b!);
    expect(b!).toBeGreaterThan(c!);
  });

  it("matches the daypart across midnight in Lagos time", () => {
    // Now: 23:30 Lagos (22:30Z). A past order at 01:00 Lagos (00:00Z) is also late_night.
    const now = new Date("2026-10-09T22:30:00Z");
    const lateOrder = "2026-10-08T00:00:00Z";
    const noonOrder = "2026-10-08T11:00:00Z";
    const result = rankRecommendations({
      orders: [
        order({ vendorId: "v-a", placedAt: lateOrder, items: [item("a")] }),
        order({ vendorId: "v-b", placedAt: noonOrder, items: [item("b")] }),
      ],
      events: [],
      now,
      candidates: [candidate({ menuItemId: "a" }), candidate({ menuItemId: "b" })],
    });
    expect(byId(result.items, "a").score).toBeGreaterThan(byId(result.items, "b").score);
  });

  it("rewards price in the customer's usual range and penalises distance", () => {
    const orders = [
      order({ vendorId: "v-x", items: [item("x1", 100_000), item("x2", 200_000), item("x3", 300_000)] }),
    ];
    const result = rankRecommendations({
      orders,
      events: [],
      now: NOW,
      candidates: [
        candidate({ menuItemId: "fit", priceKobo: 200_000, vendorId: "v-1" }),
        candidate({ menuItemId: "pricey", priceKobo: 900_000, vendorId: "v-2" }),
        candidate({ menuItemId: "far", priceKobo: 200_000, vendorId: "v-3", distanceM: 9000 }),
      ],
    });
    expect(byId(result.items, "fit").score).toBeGreaterThan(byId(result.items, "pricey").score);
    expect(byId(result.items, "fit").score).toBeGreaterThan(byId(result.items, "far").score);
  });

  it("labels a weakly-signalled similar item 'fits your usual spending range' when its price is in range", () => {
    const result = rankRecommendations({
      orders: [order({ vendorId: "v-x", items: [item("x1", 100_000), item("x2", 200_000), item("x3", 300_000)] })],
      events: [event({ eventType: "view_vendor", vendorId: "v-y" })],
      now: NOW,
      candidates: [
        candidate({ menuItemId: "y1", vendorId: "v-y", priceKobo: 200_000 }),
        candidate({ menuItemId: "y2", vendorId: "v-y", priceKobo: 900_000 }),
      ],
    });
    expect(byId(result.items, "y1")).toMatchObject({
      bucket: "similar",
      reasonCode: "price_fit",
      reason: "Fits your usual spending range",
    });
    // Out of range and weak: falls back to the (weak) behavioural reason, not price.
    expect(byId(result.items, "y2").reasonCode).toBe("usual_restaurant");
  });

  it("applies the availability penalty only when flagged", () => {
    const run = (unavailable: boolean) =>
      rankRecommendations({
        orders: [order({ vendorId: "v-a", items: [item("a")] })],
        events: [],
        now: NOW,
        candidates: [candidate({ menuItemId: "a", unavailable })],
      }).items[0]!.score;
    expect(run(true)).toBeCloseTo(run(false) - RECOMMENDATION_CONFIG.scoreCaps.availabilityPenalty, 2);
  });

  it("never exceeds the sum of caps nor goes NaN", () => {
    const result = rankRecommendations({
      orders: Array.from({ length: 30 }, (_, i) =>
        order({ vendorId: "v-a", placedAt: daysAgo(i), vendorRating: 5, items: [item("a")] }),
      ),
      events: Array.from({ length: 50 }, () => event({ eventType: "cart_add", menuItemId: "a", vendorId: "v-a" })),
      now: NOW,
      candidates: [candidate({ menuItemId: "a" })],
    });
    const caps = RECOMMENDATION_CONFIG.scoreCaps;
    const max =
      caps.personalPreference + caps.recentBehavior + caps.timePreference + caps.restaurantPreference + caps.priceFit;
    expect(result.items[0]!.score).toBeLessThanOrEqual(max);
    expect(Number.isFinite(result.items[0]!.score)).toBe(true);
  });
});

describe("rankRecommendations - reasons", () => {
  it("uses 'ordered recently' for an item ordered inside the recent window", () => {
    const result = rankRecommendations({
      orders: [order({ vendorId: "v-a", placedAt: daysAgo(3), items: [item("a")] })],
      events: [],
      now: NOW,
      candidates: [candidate({ menuItemId: "a", name: "Jollof Rice" })],
    });
    expect(result.items[0]).toMatchObject({
      reasonCode: "ordered_recently",
      reason: "Because you ordered Jollof Rice recently",
      bucket: "familiar",
    });
  });

  it("uses 'ordered before' once the order falls outside the recent window", () => {
    const result = rankRecommendations({
      orders: [order({ vendorId: "v-a", placedAt: daysAgo(60), items: [item("a")] })],
      events: [],
      now: NOW,
      candidates: [candidate({ menuItemId: "a", name: "Jollof Rice" })],
    });
    expect(result.items[0]).toMatchObject({
      reasonCode: "ordered_before",
      reason: "Because you ordered Jollof Rice before",
    });
  });

  it("uses the category label for a similar item in a liked category", () => {
    const result = rankRecommendations({
      orders: [order({ vendorId: "v-a", items: [item("a", 200_000, "rice_dishes")] })],
      events: [],
      now: NOW,
      candidates: [
        candidate({ menuItemId: "a", vendorId: "v-a", categoryKey: "rice_dishes" }),
        candidate({ menuItemId: "b", vendorId: "v-b", categoryKey: "rice_dishes" }),
      ],
    });
    expect(byId(result.items, "b")).toMatchObject({
      bucket: "similar",
      reasonCode: "category_preference",
      reason: "Because you like Rice Dishes",
    });
  });

  it("uses 'usual restaurant' for a similar item from a vendor the customer orders from", () => {
    const result = rankRecommendations({
      orders: [order({ vendorId: "v-a", items: [item("a", 200_000, "rice_dishes")] })],
      events: [],
      now: NOW,
      candidates: [
        candidate({ menuItemId: "a", vendorId: "v-a", categoryKey: "rice_dishes" }),
        candidate({ menuItemId: "b", vendorId: "v-a", categoryKey: "drinks" }),
      ],
    });
    expect(byId(result.items, "b")).toMatchObject({
      bucket: "similar",
      reasonCode: "usual_restaurant",
      reason: "From your usual restaurant, open now",
    });
  });

  it("uses 'something new to try' for an explore item", () => {
    const result = rankRecommendations({
      orders: [order({ vendorId: "v-a", items: [item("a", 200_000, "rice_dishes")] })],
      events: [],
      now: NOW,
      candidates: [
        candidate({ menuItemId: "a", vendorId: "v-a", categoryKey: "rice_dishes" }),
        candidate({ menuItemId: "z", vendorId: "v-z", categoryKey: "pastries_bakery" }),
      ],
    });
    expect(byId(result.items, "z")).toMatchObject({
      bucket: "explore",
      reasonCode: "explore_new",
      reason: "Something new to try",
    });
  });

  it("uses 'usual time' when time-of-day is the dominant component", () => {
    // Item ordered once, long ago (small personal/price), but on a Friday evening.
    const cfg: RecommendationConfig = {
      ...RECOMMENDATION_CONFIG,
      scoreCaps: { ...RECOMMENDATION_CONFIG.scoreCaps, personalPreference: 1, priceFit: 0, restaurantPreference: 0 },
    };
    const result = rankRecommendations({
      orders: [order({ vendorId: "v-a", placedAt: "2026-10-02T18:30:00Z", items: [item("a")] })],
      events: [],
      now: NOW,
      config: cfg,
      candidates: [candidate({ menuItemId: "a" })],
    });
    expect(result.items[0]).toMatchObject({ reasonCode: "usual_time", reason: "You usually order around this time" });
  });

  it("falls back to a viewed-before reason for an old, non-order interaction", () => {
    const result = rankRecommendations({
      orders: [],
      events: [event({ eventType: "view_item", menuItemId: "a", createdAt: daysAgo(40) })],
      now: NOW,
      candidates: [candidate({ menuItemId: "a", name: "Moi Moi" })],
    });
    expect(result.items[0]).toMatchObject({
      reasonCode: "viewed_before",
      reason: "Because you looked at Moi Moi before",
    });
  });

  it("never mentions other customers", () => {
    const result = rankRecommendations({
      orders: [order({ vendorId: "v-a", items: [item("a")] })],
      events: [event({ eventType: "view_item", menuItemId: "b" })],
      now: NOW,
      candidates: [candidate({ menuItemId: "a" }), candidate({ menuItemId: "b" }), candidate({ menuItemId: "c" })],
    });
    for (const i of result.items) expect(i.reason).not.toMatch(/other (customers|people)|popular|everyone|others/i);
  });
});

describe("rankRecommendations - mix, variety, determinism", () => {
  // 4 familiar, 3 similar (shared category), 3 explore, all distinct vendors.
  function mixedWorld() {
    const familiarIds = ["f1", "f2", "f3", "f4"];
    const similarIds = ["s1", "s2", "s3"];
    const exploreIds = ["e1", "e2", "e3"];
    const orders = familiarIds.map((id, i) =>
      order({ vendorId: `v-${id}`, placedAt: daysAgo(2 + i), items: [item(id, 200_000, "rice_dishes")] }),
    );
    const candidates = [
      ...familiarIds.map((id) => candidate({ menuItemId: id, categoryKey: "rice_dishes" })),
      ...similarIds.map((id) => candidate({ menuItemId: id, categoryKey: "rice_dishes" })),
      ...exploreIds.map((id, i) =>
        candidate({ menuItemId: id, categoryKey: "pastries_bakery", vendorRatingAvg: 4.9 - i * 0.2, vendorRatingCount: 80 }),
      ),
    ];
    return { orders, candidates };
  }

  it("fills 3 familiar / 1 similar / 1 explore", () => {
    const { orders, candidates } = mixedWorld();
    const result = rankRecommendations({ orders, events: [], candidates, now: NOW });
    expect(result.personalised).toBe(true);
    expect(result.items).toHaveLength(5);
    const count = (b: string) => result.items.filter((i) => i.bucket === b).length;
    expect(count("familiar")).toBe(3);
    expect(count("similar")).toBe(1);
    expect(count("explore")).toBe(1);
    // The explore pick is the best-rated explore candidate.
    expect(result.items.find((i) => i.bucket === "explore")!.menuItemId).toBe("e1");
  });

  it("backfills unused slots from the other buckets when one is short", () => {
    const { orders, candidates } = mixedWorld();
    // Remove every explore candidate: the explore slot is backfilled.
    const noExplore = candidates.filter((c) => !c.menuItemId.startsWith("e"));
    const result = rankRecommendations({ orders, events: [], candidates: noExplore, now: NOW });
    expect(result.items).toHaveLength(5);
    expect(result.items.filter((i) => i.bucket === "explore")).toHaveLength(0);
    expect(result.items.filter((i) => i.bucket === "familiar")).toHaveLength(4);
    expect(result.items.filter((i) => i.bucket === "similar")).toHaveLength(1);
  });

  it("returns fewer than total when there are not enough candidates", () => {
    const { orders, candidates } = mixedWorld();
    const result = rankRecommendations({ orders, events: [], candidates: candidates.slice(0, 2), now: NOW });
    expect(result.items).toHaveLength(2);
  });

  it("returns at most 2 items per vendor and no duplicates", () => {
    const orders = [order({ vendorId: "same", items: [item("a"), item("b"), item("c"), item("d")] })];
    const candidates = [
      ...["a", "b", "c", "d"].map((id) => candidate({ menuItemId: id, vendorId: "same" })),
      candidate({ menuItemId: "a", vendorId: "same" }), // duplicate input row
      candidate({ menuItemId: "z", vendorId: "other" }),
    ];
    const result = rankRecommendations({ orders, events: [], candidates, now: NOW });
    const perVendor = new Map<string, number>();
    for (const i of result.items) perVendor.set(i.vendorId, (perVendor.get(i.vendorId) ?? 0) + 1);
    expect(Math.max(...perVendor.values())).toBeLessThanOrEqual(2);
    expect(new Set(result.items.map((i) => i.menuItemId)).size).toBe(result.items.length);
    expect(result.items.map((i) => i.menuItemId)).toContain("z");
  });

  it("honours a config override for maxPerVendor and total", () => {
    const cfg: RecommendationConfig = {
      ...RECOMMENDATION_CONFIG,
      mix: { ...RECOMMENDATION_CONFIG.mix, total: 3, maxPerVendor: 1 },
    };
    const orders = [order({ vendorId: "same", items: [item("a"), item("b")] })];
    const candidates = [
      candidate({ menuItemId: "a", vendorId: "same" }),
      candidate({ menuItemId: "b", vendorId: "same" }),
      candidate({ menuItemId: "c", vendorId: "v-c" }),
    ];
    const result = rankRecommendations({ orders, events: [], candidates, now: NOW, config: cfg });
    expect(result.items.filter((i) => i.vendorId === "same")).toHaveLength(1);
    expect(result.items.length).toBeLessThanOrEqual(3);
  });

  it("marks a result with only explore picks as non-personalised even with signals", () => {
    const result = rankRecommendations({
      orders: [order({ vendorId: "gone", items: [item("gone-item", 200_000, "drinks")] })],
      events: [],
      now: NOW,
      candidates: [candidate({ menuItemId: "x", categoryKey: "pastries_bakery" })],
    });
    expect(result.personalised).toBe(false);
    expect(result.items[0]!.bucket).toBe("explore");
  });

  it("is deterministic and does not mutate its input", () => {
    const { orders, candidates } = mixedWorld();
    const events = [event({ eventType: "view_item", menuItemId: "s1" })];
    const input = { orders, events, candidates, now: NOW };
    const frozen = JSON.stringify(input);
    const first = rankRecommendations(input);
    const second = rankRecommendations({ ...input, candidates: [...candidates].reverse() });
    expect(JSON.stringify(input)).toBe(frozen);
    expect(second).toEqual(first);
  });

  it("breaks exact score ties by price then id", () => {
    const result = rankRecommendations({
      orders: [],
      events: [],
      now: NOW,
      candidates: [
        candidate({ menuItemId: "b", priceKobo: 100_000 }),
        candidate({ menuItemId: "a", priceKobo: 100_000 }),
      ],
    });
    expect(result.items.map((i) => i.menuItemId)).toEqual(["a", "b"]);
  });

  it("drops candidates with an invalid kobo price instead of throwing", () => {
    const result = rankRecommendations({
      orders: [],
      events: [],
      now: NOW,
      candidates: [candidate({ menuItemId: "bad", priceKobo: 12.5 }), candidate({ menuItemId: "ok" })],
    });
    expect(result.items.map((i) => i.menuItemId)).toEqual(["ok"]);
  });

  it("uses the candidate's category for order items that carry none", () => {
    const result = rankRecommendations({
      orders: [order({ vendorId: "v-a", items: [item("a")] })], // no categoryKey on the order item
      events: [],
      now: NOW,
      candidates: [
        candidate({ menuItemId: "a", vendorId: "v-a", categoryKey: "soups" }),
        candidate({ menuItemId: "b", vendorId: "v-b", categoryKey: "soups" }),
      ],
    });
    expect(byId(result.items, "b").bucket).toBe("similar");
  });
});

describe("RECOMMENDATION_CONFIG", () => {
  it("is deeply frozen and carries the spec placeholders", () => {
    expect(Object.isFrozen(RECOMMENDATION_CONFIG)).toBe(true);
    expect(Object.isFrozen(RECOMMENDATION_CONFIG.actionWeights)).toBe(true);
    expect(Object.isFrozen(RECOMMENDATION_CONFIG.time.dayparts[0])).toBe(true);
    expect(RECOMMENDATION_CONFIG.actionWeights).toMatchObject({
      ordered: 10,
      reordered: 15,
      cartAdd: 7,
      search: 4,
      viewItem: 2,
      positiveRating: 8,
      cancelled: -5,
      cartRemove: 0,
      recommendationClick: 0,
    });
    expect(RECOMMENDATION_CONFIG.scoreCaps).toMatchObject({
      personalPreference: 40,
      recentBehavior: 20,
      timePreference: 15,
      restaurantPreference: 10,
      localPopularity: 0,
      similarCustomers: 0,
      priceFit: 7,
      distancePenalty: 5,
    });
    expect(RECOMMENDATION_CONFIG.mix.total).toBe(5);
    expect(RECOMMENDATION_CONFIG.lookbackDays).toBe(180);
    expect(() => {
      (RECOMMENDATION_CONFIG as { lookbackDays: number }).lookbackDays = 1;
    }).toThrow();
  });
});

describe("rankRecommendations - exact spec weights (regression: weights are wired to the right signals)", () => {
  // Isolate ONE component: huge cap and huge saturation constant make
  // squash(raw) ~= raw, so the score reads back the raw (decay=1) weight.
  const BIG = 1e9;
  const isolate = (component: "personalPreference" | "recentBehavior"): RecommendationConfig => ({
    ...RECOMMENDATION_CONFIG,
    categoryAffinityFactor: 0,
    scoreCaps: {
      ...RECOMMENDATION_CONFIG.scoreCaps,
      personalPreference: component === "personalPreference" ? BIG : 0,
      recentBehavior: component === "recentBehavior" ? BIG : 0,
      timePreference: 0,
      restaurantPreference: 0,
      priceFit: 0,
      distancePenalty: 0,
      vendorQuality: 0,
    },
    saturation: { ...RECOMMENDATION_CONFIG.saturation, personalPreference: BIG, recentBehavior: BIG },
  });
  const nowIso = NOW.toISOString();
  const scoreOf = (
    component: "personalPreference" | "recentBehavior",
    orders: RecOrder[],
    events: RecEvent[],
    cand: Partial<RecCandidate> = {},
  ) =>
    rankRecommendations({
      orders,
      events,
      now: NOW,
      config: isolate(component),
      candidates: [candidate({ menuItemId: "a", vendorId: "v-a", name: "Jollof Rice", ...cand })],
    }).items[0]!.score;

  it("first order of an item = 10, second order of the same item = 10 + 15", () => {
    expect(scoreOf("personalPreference", [order({ vendorId: "v-a", placedAt: nowIso, items: [item("a")] })], [])).toBeCloseTo(10, 3);
    expect(
      scoreOf(
        "personalPreference",
        [
          order({ vendorId: "v-a", placedAt: nowIso, items: [item("a")] }),
          order({ vendorId: "v-a", placedAt: nowIso, items: [item("a")] }),
        ],
        [],
      ),
    ).toBeCloseTo(25, 3);
  });

  it("a positive rating (>= 4) adds 8 to the order's items; 3 stars adds nothing", () => {
    const rated = (r: number) =>
      scoreOf("personalPreference", [order({ vendorId: "v-a", placedAt: nowIso, vendorRating: r, items: [item("a")] })], []);
    expect(rated(4)).toBeCloseTo(18, 3);
    expect(rated(5)).toBeCloseTo(18, 3);
    expect(rated(3)).toBeCloseTo(10, 3);
  });

  it("a cancelled_by_customer order contributes -5 to its items", () => {
    const result = rankRecommendations({
      orders: [order({ vendorId: "v-a", placedAt: nowIso, status: "cancelled_by_customer", items: [item("a")] })],
      events: [],
      now: NOW,
      config: isolate("personalPreference"),
      candidates: [candidate({ menuItemId: "a", vendorId: "v-a" })],
    });
    expect(result.items[0]!.score).toBeCloseTo(-5, 3);
  });

  it("recent cart_add = 7, view_item = 2, search match = 4 (recent window)", () => {
    expect(scoreOf("recentBehavior", [], [event({ eventType: "cart_add", menuItemId: "a", createdAt: nowIso })])).toBeCloseTo(7, 3);
    expect(scoreOf("recentBehavior", [], [event({ eventType: "view_item", menuItemId: "a", createdAt: nowIso })])).toBeCloseTo(2, 3);
    expect(scoreOf("recentBehavior", [], [event({ eventType: "search", searchQuery: "jollof", createdAt: nowIso })])).toBeCloseTo(4, 3);
  });

  it("weights are exactly the spec numbers and a signal's decay halves it after one half-life", () => {
    const w = RECOMMENDATION_CONFIG.actionWeights;
    expect([w.ordered, w.reordered, w.cartAdd, w.search, w.viewItem, w.positiveRating, w.cancelled]).toEqual([10, 15, 7, 4, 2, 8, -5]);
    const thirtyDaysAgo = daysAgo(30);
    expect(
      scoreOf("personalPreference", [order({ vendorId: "v-a", placedAt: thirtyDaysAgo, items: [item("a")] })], []),
    ).toBeCloseTo(5, 3);
  });
});

describe("rankRecommendations - mix invariants under backfill", () => {
  it("never exceeds 2 per vendor even when backfilling a short bucket from a single dominant vendor", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const result = rankRecommendations({
      orders: [order({ vendorId: "big", items: ids.map((id) => item(id)) })],
      events: [],
      now: NOW,
      candidates: ids.map((id) => candidate({ menuItemId: id, vendorId: "big" })),
    });
    expect(result.items).toHaveLength(2);
    expect(result.items.every((i) => i.vendorId === "big")).toBe(true);
  });

  it("is order-independent for orders and events too (determinism)", () => {
    const orders = [
      order({ vendorId: "v-a", placedAt: daysAgo(2), items: [item("a")] }),
      order({ vendorId: "v-b", placedAt: daysAgo(9), items: [item("b")] }),
    ];
    const events = [
      event({ eventType: "cart_add", menuItemId: "c", vendorId: "v-c" }),
      event({ eventType: "view_item", menuItemId: "d", vendorId: "v-d" }),
    ];
    const candidates = ["a", "b", "c", "d", "e"].map((id) => candidate({ menuItemId: id }));
    const first = rankRecommendations({ orders, events, candidates, now: NOW });
    const second = rankRecommendations({ orders: [...orders].reverse(), events: [...events].reverse(), candidates, now: NOW });
    expect(second).toEqual(first);
  });
});
