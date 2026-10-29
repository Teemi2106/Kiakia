import { describe, expect, it } from "vitest";
import { lastSeenText, rankHotspots, riderStatus, summarizeRiders, toFleetRider, type FleetRider, type FleetRiderRow } from "./fleet-info";

const HERE = { lat: 9.05, lng: 7.45 };

function rider(overrides: Partial<FleetRider> = {}): FleetRider {
  return {
    userId: "r1",
    fullName: "Tunde",
    phone: null,
    vehicleType: null,
    kycStatus: "approved",
    isOnline: true,
    isLive: true,
    lastPingAt: null,
    position: HERE,
    delivery: null,
    ...overrides,
  };
}

const DELIVERY = { orderId: "o1", orderCode: "KK-000001", status: "in_transit", vendorName: "Mama Put", destinationCity: "Abuja", destination: null };

describe("riderStatus", () => {
  it("puts a rider on a delivery first, even if their signal is stale", () => {
    expect(riderStatus(rider({ delivery: DELIVERY, isLive: false }))).toBe("delivering");
  });

  it("separates live, silent and offline riders", () => {
    expect(riderStatus(rider())).toBe("available");
    expect(riderStatus(rider({ isLive: false }))).toBe("no_signal");
    expect(riderStatus(rider({ isOnline: false, isLive: false }))).toBe("offline");
  });
});

describe("lastSeenText", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");

  it("reads naturally at each scale", () => {
    expect(lastSeenText(null, now)).toBe("Never");
    expect(lastSeenText("2026-10-29T11:59:30Z", now)).toBe("Just now");
    expect(lastSeenText("2026-10-29T11:55:00Z", now)).toBe("5 min ago");
    expect(lastSeenText("2026-10-29T09:00:00Z", now)).toBe("3 h ago");
    expect(lastSeenText("2026-10-27T12:00:00Z", now)).toBe("2 d ago");
  });

  it("never goes negative on a clock-skewed ping", () => {
    expect(lastSeenText("2026-10-29T12:05:00Z", now)).toBe("Just now");
  });
});

describe("summarizeRiders", () => {
  it("counts each status once", () => {
    const summary = summarizeRiders([
      rider({ userId: "a" }),
      rider({ userId: "b", delivery: DELIVERY }),
      rider({ userId: "c", isLive: false }),
      rider({ userId: "d", isOnline: false, isLive: false }),
      rider({ userId: "e", isOnline: false, isLive: false }),
    ]);
    expect(summary).toEqual({ total: 5, delivering: 1, available: 1, noSignal: 1, offline: 2 });
  });

  it("handles an empty fleet", () => {
    expect(summarizeRiders([])).toEqual({ total: 0, delivering: 0, available: 0, noSignal: 0, offline: 0 });
  });
});

describe("rankHotspots", () => {
  const cells = [
    { lat: 9.05, lng: 7.45, orders: 4 },
    { lat: 9.2, lng: 7.6, orders: 9 },
    { lat: 9.3, lng: 7.7, orders: 2 },
  ];

  it("orders the busiest first, numbers them and honours the limit", () => {
    const spots = rankHotspots(cells, [], 2);
    expect(spots.map((spot) => [spot.rank, spot.orders])).toEqual([
      [1, 9],
      [2, 4],
    ]);
  });

  it("counts only free, live riders within range", () => {
    const riders = [
      rider({ userId: "near-free" }),
      rider({ userId: "near-busy", delivery: DELIVERY }),
      rider({ userId: "near-offline", isOnline: false, isLive: false }),
      rider({ userId: "far-free", position: { lat: 9.5, lng: 7.9 } }),
      rider({ userId: "no-position", position: null }),
    ];
    const spots = rankHotspots(cells, riders);
    expect(spots.find((spot) => spot.orders === 4)?.freeRidersNearby).toBe(1);
    expect(spots.find((spot) => spot.orders === 9)?.freeRidersNearby).toBe(0);
  });
});

describe("toFleetRider", () => {
  const row: FleetRiderRow = {
    user_id: "r1",
    full_name: "Tunde",
    phone: "+2348012345678",
    vehicle_type: "bike",
    kyc_status: "approved",
    is_online: true,
    is_live: null,
    last_ping_at: "2026-10-29T10:00:00Z",
    lat: 9.05,
    lng: 7.45,
    order_id: null,
    order_code: null,
    order_status: null,
    vendor_name: null,
    dest_city: null,
    dest_lat: null,
    dest_lng: null,
  };

  it("treats a null live flag as not live and no order as no delivery", () => {
    const mapped = toFleetRider(row);
    expect(mapped.isLive).toBe(false);
    expect(mapped.delivery).toBeNull();
    expect(mapped.position).toEqual(HERE);
  });

  it("maps an active delivery and tolerates a missing destination", () => {
    const mapped = toFleetRider({ ...row, is_live: true, order_id: "o1", order_code: "KK-000001", order_status: "picked_up", vendor_name: "Mama Put", dest_city: "Abuja" });
    expect(mapped.isLive).toBe(true);
    expect(mapped.delivery).toMatchObject({ orderCode: "KK-000001", vendorName: "Mama Put", destination: null });
  });
});
