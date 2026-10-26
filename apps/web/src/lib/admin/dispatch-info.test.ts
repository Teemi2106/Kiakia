import { describe, expect, it } from "vitest";
import {
  beingHandled,
  describeAttentionReason,
  describeDistances,
  describeLastAttempt,
  describeWaiting,
  formatTravel,
  formatWaiting,
  mapStatusOrder,
  mapStatusPayload,
  needsAttention,
  parseRedispatchResult,
  parseStatusPayload,
  readDispatchStatus,
  redispatchMessage,
  type DispatchStatusOrder,
} from "./dispatch-info";

const NOW = Date.parse("2026-10-21T16:00:00Z");
const payload = { online_riders: 1, settings: { radius_m: 5000 } };

function row(overrides: Partial<DispatchStatusOrder> = {}): DispatchStatusOrder {
  return {
    order_id: "o1",
    code: "KK-1001",
    vendor_id: "v1",
    vendor_name: "Mama Put",
    waiting_since: "2026-10-21T15:37:00Z",
    offers_made: 0,
    nearest_online_rider_m: 8500,
    riders_within_radius: 0,
    riders_within_store_radius: 1,
    store_radius_m: 20_000,
    eligible_riders: 1,
    fundable_riders_in_range: 0,
    delivery_by: "rider",
    last_attempt: { at: "2026-10-21T15:38:00Z", radius_m: 5000, riders_in_range: 0, offers_created: 0 },
    reason: "none_in_range",
    widened: false,
    dispatch_state: "searching",
    live_offer: null,
    cycle_no: 1,
    attempts_made: 0,
    start_at: "2026-10-21T15:37:00Z",
    expected_ready_at: "2026-10-21T15:50:00Z",
    needs_attention: false,
    attention_reason: null,
    ...overrides,
  };
}

const map = (overrides: Partial<DispatchStatusOrder> = {}) => mapStatusOrder(row(overrides), payload, NOW);

describe("mapStatusOrder", () => {
  it("is the real incident: one rider 8.5 km away with a 5 km radius", () => {
    const order = map();
    expect(order).toMatchObject({ reason: "none_in_range", nearestRiderM: 8500, orderCode: "KK-1001", waitingSeconds: 23 * 60, radiusM: 5000, storeRadiusM: 20_000, ridersOnline: 1 });
  });

  it("reads the live offer, round, riders asked and the predicted times", () => {
    const order = map({
      reason: "waiting_for_rider_reply",
      live_offer: { rider_name: "Ada Bello", attempt_no: 2, seconds_left: 31, eta_seconds: 420 },
      cycle_no: 1,
      attempts_made: 2,
    });
    expect(order).toMatchObject({
      reason: "waiting_for_rider_reply",
      liveOffer: { riderName: "Ada Bello", attemptNo: 2, secondsLeft: 31, etaSeconds: 420 },
      roundNo: 1,
      attemptsMade: 2,
      expectedReadyAt: "2026-10-21T15:50:00Z",
      startAt: "2026-10-21T15:37:00Z",
    });
  });

  it("reads an unknown reason like the database's own fallback, and copes with missing numbers", () => {
    const order = mapStatusOrder({ order_id: "o2", reason: "something_new" }, {}, NOW);
    expect(order.reason).toBe("needs_attention");
    expect(order.orderCode).toBe("o2");
    expect(order.nearestRiderM).toBeNull();
    expect(order.waitingSeconds).toBe(0);
    expect(order.lastAttempt).toBeNull();
    expect(order.liveOffer).toBeNull();
    expect(order.needsAttention).toBe(false);
  });

  it("maps the whole payload and an empty one", () => {
    expect(mapStatusPayload({ ...payload, stuck_orders: [row(), row({ order_id: "o2" })] }, NOW)).toHaveLength(2);
    expect(mapStatusPayload(null, NOW)).toEqual([]);
    expect(mapStatusPayload({}, NOW)).toEqual([]);
  });
});

describe("readDispatchStatus", () => {
  it("reads orders, the upcoming list and the attention count", () => {
    const status = readDispatchStatus(
      {
        ...payload,
        needs_attention_count: 2,
        stuck_orders: [row()],
        upcoming: [{ order_id: "u1", code: "KK-2", vendor_name: "Bukka", expected_ready_at: "2026-10-21T16:20:00Z", start_at: "2026-10-21T16:09:00Z", starts_in_seconds: 540 }],
      },
      NOW,
    );
    expect(status.needsAttentionCount).toBe(2);
    expect(status.onlineRiders).toBe(1);
    expect(status.orders).toHaveLength(1);
    expect(status.upcoming).toEqual([
      { orderId: "u1", orderCode: "KK-2", vendorName: "Bukka", expectedReadyAt: "2026-10-21T16:20:00Z", startAt: "2026-10-21T16:09:00Z", startsInSeconds: 540 },
    ]);
  });

  it("accepts an old-style document with none of the new keys, and an empty one", () => {
    expect(readDispatchStatus({ online_riders: 0, stuck_orders: [{ order_id: "o1" }] }, NOW).orders).toHaveLength(1);
    expect(readDispatchStatus(null, NOW)).toMatchObject({ orders: [], upcoming: [], needsAttentionCount: 0 });
  });

  it("refuses a document of the wrong shape instead of showing an empty page", () => {
    expect(() => parseStatusPayload({ stuck_orders: "nope" })).toThrow(/unexpected shape/);
    expect(() => readDispatchStatus({ stuck_orders: [{ code: "no order id" }] })).toThrow(/unexpected shape/);
  });
});

describe("describeWaiting", () => {
  it("names the distance and how to fix it", () => {
    const text = describeWaiting(map());
    expect(text.headline).toBe("Riders are online but none within 5 km: the nearest is 8.5 km away.");
    expect(text.action).toContain("widens by itself to the store's own distance (20 km)");
    expect(text.action).toContain("raise the first distance (to at least 9 km)");
    expect(text.mentionsSettings).toBe(true);
  });

  it("uses the store's own distance once the order is searching wider", () => {
    const text = describeWaiting(map({ widened: true, nearest_online_rider_m: 25_000 }));
    expect(text.headline).toBe("Riders are online but none within 20 km: the nearest is 25 km away.");
    expect(text.action).toContain("already covers everything this store delivers to");
  });

  it("states both distances", () => {
    expect(describeDistances(map())).toBe("Looked within 5 km; this store delivers up to 20 km");
    expect(describeDistances(map({ store_radius_m: null }))).toBe("Looked within 5 km");
  });

  it("explains an unfundable rider in very plain words (the real incident)", () => {
    const text = describeWaiting(map({ reason: "fee_exceeds_order_budget", riders_within_radius: 1, nearest_online_rider_m: 3000 }));
    expect(text.headline).toBe("A rider is nearby, but paying them for this distance would cost more than this order brings in.");
    expect(text.action).toContain("too small to cover what a rider would earn");
  });

  it("with no first-round limit there is nothing to widen", () => {
    const noLimit = mapStatusOrder(row({ nearest_online_rider_m: 60_000 }), { ...payload, settings: { radius_m: 0 } }, NOW);
    expect(describeWaiting(noLimit).headline).toBe("Riders are online but none within any distance: the nearest is 60 km away.");
    expect(describeWaiting(noLimit).action).toContain("already covers everything this store delivers to");
    expect(describeDistances(noLimit)).toBe("No distance limit is set, so every online rider was considered; this store delivers up to 20 km");
  });

  it("has plain wording for the rest of the stuck reasons", () => {
    expect(describeWaiting(map({ reason: "no_online_riders", eligible_riders: 0 })).headline).toMatch(/^No rider can take this order right now \(1 online/);
    expect(describeWaiting(mapStatusOrder(row({ reason: "no_online_riders" }), { online_riders: 0, settings: { radius_m: 5000 } }, NOW)).headline).toBe("No riders are online.");
    expect(describeWaiting(map({ reason: "all_declined_or_expired" })).headline).toBe("All offered riders declined or ran out of time.");
  });

  it("says when the search starts (Lagos time) for a scheduled order", () => {
    const text = describeWaiting(map({ reason: "scheduled", start_at: "2026-10-21T16:09:00Z", expected_ready_at: "2026-10-21T16:20:00Z" }));
    expect(text.headline).toBe("Search starts at 17:09.");
    expect(text.action).toContain("food expected ready at 17:20");
    expect(describeWaiting(map({ reason: "scheduled", start_at: null })).headline).toBe("The search for a rider has not started yet.");
  });

  it("says who is being asked and how long they have left", () => {
    const order = map({ reason: "waiting_for_rider_reply", live_offer: { rider_name: "Ada Bello", attempt_no: 1, seconds_left: 23, eta_seconds: 300 } });
    expect(describeWaiting(order).headline).toBe("Waiting for Ada Bello to answer, 23s left.");
    expect(describeWaiting(map({ reason: "waiting_for_rider_reply" })).headline).toBe("Waiting for a rider to answer.");
    expect(describeWaiting(order).action).toContain("next rider is asked straight away");
  });

  it("puts the reason a flagged order needs attention in plain words", () => {
    expect(describeWaiting(map({ reason: "needs_attention", needs_attention: true, attention_reason: "two_cycles_without_accept" })).headline).toBe(
      "No rider accepted after two full rounds.",
    );
    expect(describeAttentionReason("worker_errors")).toBe("The system hit errors while searching");
    expect(describeAttentionReason("no_candidates")).toBe("No rider nearby for a while");
    expect(describeAttentionReason(null)).toBe("No rider nearby for a while");
  });

  it("never uses the engine's jargon in what an admin reads", () => {
    const orders = [
      map({ reason: "scheduled" }),
      map({ reason: "waiting_for_rider_reply", live_offer: { rider_name: "Ada", attempt_no: 1, seconds_left: 5, eta_seconds: 60 } }),
      map({ reason: "needs_attention", needs_attention: true, attention_reason: "worker_errors" }),
      map({ reason: "none_in_range" }),
      map({ reason: "no_online_riders" }),
      map({ reason: "all_declined_or_expired" }),
      map({ reason: "fee_exceeds_order_budget", riders_within_radius: 2 }),
    ];
    const words = orders.map((order) => Object.values(describeWaiting(order)).join(" ")).join(" ");
    expect(words).not.toMatch(/\bH3\b|\bring\b|\bcycle\b|\bKNN\b|\bTTL\b/i);
  });
});

describe("who needs attention", () => {
  it("separates orders being searched on schedule from the ones that need someone", () => {
    const orders = mapStatusPayload(
      {
        ...payload,
        stuck_orders: [
          row(),
          row({ order_id: "o2", reason: "waiting_for_rider_reply" }),
          row({ order_id: "o3", delivery_by: "vendor" }),
          row({ order_id: "o4", reason: "scheduled" }),
          row({ order_id: "o5", reason: "waiting_for_rider_reply", needs_attention: true }),
        ],
      },
      NOW,
    );
    expect(orders.map((order) => order.orderId)).toEqual(["o1", "o2", "o4", "o5"]);
    expect(needsAttention(orders).map((order) => order.orderId)).toEqual(["o1", "o5"]);
    expect(beingHandled(orders).map((order) => order.orderId)).toEqual(["o2", "o4"]);
  });
});

describe("describeLastAttempt", () => {
  it("reads like 'Tried at 16:38: 0 riders within 5 km' in Lagos time", () => {
    expect(describeLastAttempt(map())).toBe("Tried at 16:38: 0 riders within 5 km");
  });
  it("handles no limit, one rider, and no attempt", () => {
    expect(describeLastAttempt(map({ last_attempt: { at: "2026-10-21T15:38:00Z", radius_m: null, riders_in_range: 1, offers_created: 0 } }))).toBe("Tried at 16:38: 1 rider at any distance");
    expect(describeLastAttempt(map({ last_attempt: null }))).toBeNull();
  });
});

describe("formatWaiting / redispatch result", () => {
  it("formats waits", () => {
    expect(formatWaiting(20)).toBe("under a minute");
    expect(formatWaiting(23 * 60)).toBe("23 min");
    expect(formatWaiting(3900)).toBe("1 hr 5 min");
    expect(formatWaiting(7200)).toBe("2 hr");
    expect(formatTravel(20)).toBe("under a minute");
    expect(formatTravel(420)).toBe("about 7 min");
  });
  it("reports the result in words", () => {
    expect(redispatchMessage({ offered: 3, ridersInRange: null })).toBe("Asking 3 riders now.");
    expect(redispatchMessage({ offered: 1, ridersInRange: null })).toBe("Asking 1 rider now.");
    expect(redispatchMessage({ offered: 0, ridersInRange: 0 })).toMatch(/^No riders in range/);
    expect(redispatchMessage({ offered: 0, ridersInRange: 2 })).toMatch(/riders are in range but none can take the order/);
  });
  it("says a rider is already being asked instead of asking a second one", () => {
    expect(redispatchMessage({ offered: 0, ridersInRange: 4, liveOffer: true })).toMatch(/^A rider is already being asked/);
    expect(redispatchMessage({ offered: 0, ridersInRange: null, outcome: "not_dispatchable" })).toMatch(/can't be sent to riders right now/);
  });
  it("reads the RPC result", () => {
    expect(parseRedispatchResult({ offers_created: 1, riders_in_range: null, outcome: "offered", offer_id: "x", live_offer: false })).toEqual({
      offered: 1,
      ridersInRange: null,
      liveOffer: false,
      outcome: "offered",
    });
    expect(parseRedispatchResult({ offers_created: 0, riders_in_range: 3, outcome: "waiting", live_offer: true })).toEqual({
      offered: 0,
      ridersInRange: 3,
      liveOffer: true,
      outcome: "waiting",
    });
    expect(parseRedispatchResult(null)).toEqual({ offered: 0, ridersInRange: null, liveOffer: false, outcome: null });
  });
});
