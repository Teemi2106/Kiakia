import { describe, expect, it } from "vitest";
import { describeDistances, describeLastAttempt, describeWaiting, formatWaiting, mapStatusOrder, mapStatusPayload, parseRedispatchResult, redispatchMessage, type DispatchStatusOrder } from "./dispatch-info";

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
    offers_open: 0,
    nearest_online_rider_m: 8500,
    riders_within_radius: 0,
    riders_within_store_radius: 1,
    store_radius_m: 20_000,
    last_attempt: { at: "2026-10-21T15:38:00Z", radius_m: 5000, riders_in_range: 0, offers_created: 0 },
    reason: "none_in_range",
    widened: false,
    ...overrides,
  };
}

const map = (overrides: Partial<DispatchStatusOrder> = {}) => mapStatusOrder(row(overrides), payload, NOW);

describe("mapStatusOrder", () => {
  it("is the real incident: one rider 8.5 km away with a 5 km radius", () => {
    const order = map();
    expect(order).toMatchObject({ reason: "none_in_range", nearestRiderM: 8500, orderCode: "KK-1001", waitingSeconds: 23 * 60, radiusM: 5000, storeRadiusM: 20_000, ridersOnline: 1 });
  });

  it("treats an unknown reason as 'not offered yet' and copes with missing numbers", () => {
    const order = mapStatusOrder({ order_id: "o2", reason: "something_new" }, {}, NOW);
    expect(order.reason).toBe("awaiting_dispatch");
    expect(order.orderCode).toBe("o2");
    expect(order.nearestRiderM).toBeNull();
    expect(order.waitingSeconds).toBe(0);
    expect(order.lastAttempt).toBeNull();
  });

  it("maps the whole payload and an empty one", () => {
    expect(mapStatusPayload({ ...payload, stuck_orders: [row(), row({ order_id: "o2" })] }, NOW)).toHaveLength(2);
    expect(mapStatusPayload(null, NOW)).toEqual([]);
    expect(mapStatusPayload({}, NOW)).toEqual([]);
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
    expect(describeDistances(map({ store_radius_m: null, radius_m: 0 }))).toBe("Looked at any distance");
  });

  it("has plain wording for every other reason", () => {
    expect(describeWaiting(map({ reason: "no_online_riders" })).headline).toBe("No riders are online.");
    expect(describeWaiting(map({ reason: "offers_pending" })).headline).toBe("Offers sent, waiting for a rider to accept.");
    expect(describeWaiting(map({ reason: "all_declined_or_expired" })).headline).toBe("All offered riders declined or ran out of time.");
    expect(describeWaiting(map({ reason: "fee_exceeds_order_budget" })).headline).toMatch(/too small to cover/);
    expect(describeWaiting(map({ reason: "awaiting_dispatch" })).headline).toBe("Not offered to anyone yet.");
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
  });
  it("reports the result in words", () => {
    expect(redispatchMessage({ offered: 3, ridersInRange: null })).toBe("Sent to 3 riders.");
    expect(redispatchMessage({ offered: 1, ridersInRange: null })).toBe("Sent to 1 rider.");
    expect(redispatchMessage({ offered: 0, ridersInRange: 0 })).toMatch(/^No riders in range/);
    expect(redispatchMessage({ offered: 0, ridersInRange: 2 })).toMatch(/riders are in range but none can take it/);
  });
  it("reads the RPC result", () => {
    expect(parseRedispatchResult({ offers_created: 2, riders_in_range: null })).toEqual({ offered: 2, ridersInRange: null });
    expect(parseRedispatchResult({ offers_created: 0, riders_in_range: 0 })).toEqual({ offered: 0, ridersInRange: 0 });
    expect(parseRedispatchResult(null)).toEqual({ offered: 0, ridersInRange: null });
  });
});
