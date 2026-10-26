import { describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

const state = { client: supabaseClientMock() };
const requireAdminContext = vi.fn(() => Promise.resolve({ userId: "admin" }));
vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: () => requireAdminContext() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));

const { getDispatchHistory, getDispatchMetrics, getDispatchOverview, getDispatchSettings, getDispatchStatus, getWaitingForOrder, listRecentDispatchChanges, listWaitingForRider, toDispatchValues } =
  await import("./dispatch");

const settingsRows = [
  { key: "dispatch_radius_m", value_int: 5000, updated_at: "2026-10-01T00:00:00Z", updated_by: "u1" },
  { key: "dispatch_max_riders", value_int: 5, updated_at: "2026-10-01T00:00:00Z", updated_by: null },
  { key: "dispatch_widen_after_seconds", value_int: 120, updated_at: "2026-10-01T00:00:00Z", updated_by: null },
  { key: "dispatch_notify_vendor_after_seconds", value_int: 45, updated_at: "2026-10-01T00:00:00Z", updated_by: null },
  { key: "service_fee_bps", value_int: 250, updated_at: "2026-10-01T00:00:00Z", updated_by: null },
];
const profiles = queryBuilder(ok([{ id: "u1", full_name: "Ada Admin", phone: null, status: "active" }]));

const ORDER_ID = "33333333-3333-4333-8333-333333333333";

const payload = {
  settings: { radius_m: 5000 },
  online_riders: 1,
  needs_attention_count: 3,
  upcoming: [{ order_id: "u1", code: "KK-3", vendor_name: "Bukka", expected_ready_at: "2026-10-21T16:20:00Z", start_at: "2026-10-21T16:09:00Z", starts_in_seconds: 540 }],
  stuck_orders: [
    {
      order_id: "o1",
      code: "KK-1",
      vendor_name: "Mama Put",
      waiting_since: new Date(Date.now() - 600_000).toISOString(),
      nearest_online_rider_m: 8500,
      riders_within_radius: 0,
      riders_within_store_radius: 1,
      store_radius_m: 20_000,
      reason: "none_in_range",
    },
    {
      order_id: "o2",
      code: "KK-2",
      waiting_since: new Date(Date.now() - 300_000).toISOString(),
      reason: "waiting_for_rider_reply",
      live_offer: { offer_id: "f1", rider_name: "Ada Bello", attempt_no: 1, seconds_left: 30, eta_seconds: 300 },
    },
  ],
};

describe("dispatch settings", () => {
  it("reads only dispatch keys with who changed them, and derives the values", async () => {
    state.client = supabaseClientMock({ from: { platform_settings: queryBuilder(ok(settingsRows)), profiles } });
    const settings = await getDispatchSettings();
    expect(settings.rows.map((row) => row.key)).toEqual(["dispatch_radius_m", "dispatch_max_riders", "dispatch_widen_after_seconds", "dispatch_notify_vendor_after_seconds"]);
    expect(settings.rows[0]?.updatedByName).toBe("Ada Admin");
    expect(settings.values).toMatchObject({ radiusM: 5000, maxRiders: 5, widenAfterSeconds: 120, notifyVendorAfterSeconds: 45, offerTimeoutSeconds: 45, maxRing: 8 });
  });

  it("falls back to the migration defaults when a row is missing, and reads the new keys", () => {
    expect(toDispatchValues([])).toEqual({
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
    });
    expect(toDispatchValues([{ key: "dispatch_offer_timeout_seconds", value: 30 }, { key: "dispatch_h3_max_ring", value: 12 }, { key: "other", value: 1 }])).toMatchObject({
      offerTimeoutSeconds: 30,
      maxRing: 12,
      initialRing: 1,
    });
  });

  it("requires an admin", async () => {
    requireAdminContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(getDispatchSettings()).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("recent changes", () => {
  it("extracts before/after from the audit details", async () => {
    state.client = supabaseClientMock({
      from: {
        admin_audit_log: queryBuilder(
          ok([{ id: "1", actor_id: "u1", action: "dispatch_setting.set", reason: "Rider 8.5 km away", details: { key: "dispatch_radius_m", from: 5000, to: 10_000 }, created_at: "2026-10-02T00:00:00Z" }]),
        ),
        profiles,
      },
    });
    expect(await listRecentDispatchChanges()).toEqual([
      { id: "1", at: "2026-10-02T00:00:00Z", actorName: "Ada Admin", reason: "Rider 8.5 km away", change: { key: "dispatch_radius_m", from: 5000, to: 10_000 } },
    ]);
  });
});

describe("waiting for a rider", () => {
  it("maps the status function's orders", async () => {
    state.client = supabaseClientMock({ rpc: { admin_dispatch_status: ok(payload) } });
    const orders = await listWaitingForRider();
    expect(state.client.rpc).toHaveBeenCalledWith("admin_dispatch_status");
    expect(orders.map((order) => order.orderCode)).toEqual(["KK-1", "KK-2"]);
    expect(orders[0]).toMatchObject({ reason: "none_in_range", nearestRiderM: 8500, radiusM: 5000, storeRadiusM: 20_000, ridersOnline: 1 });
  });

  it("the tile uses the database's attention count and the same call as the page", async () => {
    state.client = supabaseClientMock({ rpc: { admin_dispatch_status: ok(payload) } });
    expect(await getDispatchOverview()).toEqual({ needsAttention: 3, waiting: 2, askingNow: 1, startingLater: 1 });
    expect((await getDispatchStatus()).upcoming).toHaveLength(1);
    expect(await listWaitingForRider()).toHaveLength(2);
    expect(await getWaitingForOrder("o2")).toMatchObject({ reason: "waiting_for_rider_reply", liveOffer: { riderName: "Ada Bello", secondsLeft: 30 } });
    expect(await getWaitingForOrder("nope")).toBeNull();
  });

  it("is empty when nothing is stuck", async () => {
    state.client = supabaseClientMock({ rpc: { admin_dispatch_status: ok({ settings: {}, online_riders: 0, needs_attention_count: 0, stuck_orders: [], upcoming: [] }) } });
    expect(await listWaitingForRider()).toEqual([]);
    expect(await getDispatchOverview()).toEqual({ needsAttention: 0, waiting: 0, askingNow: 0, startingLater: 0 });
  });

  it("surfaces a database error", async () => {
    state.client = supabaseClientMock({ rpc: { admin_dispatch_status: { data: null, error: { message: "boom" } } } });
    await expect(listWaitingForRider()).rejects.toThrow("boom");
  });
});

describe("dispatch history", () => {
  const history = {
    order: { id: ORDER_ID, code: "KK-9", status: "ready_for_pickup", delivery_by: "rider", rider_id: null },
    dispatch: { state: "offered", cycle_no: 1 },
    offers: [{ offer_id: "f1", rider_id: "r1", rider_name: "Ada Bello", cycle_no: 1, attempt_no: 1, status: "declined", close_reason: null, distance_m: 900, eta_seconds: 200 }],
    events: [],
  };

  it("asks the database for one order's history", async () => {
    state.client = supabaseClientMock({ rpc: { admin_dispatch_order_history: ok(history) } });
    expect(await getDispatchHistory(ORDER_ID)).toMatchObject({ orderCode: "KK-9", offers: [{ riderName: "Ada Bello", outcome: "Declined" }] });
    expect(state.client.rpc).toHaveBeenCalledWith("admin_dispatch_order_history", { p_order_id: ORDER_ID });
  });

  it("is null for a bad id or an order that does not exist, and throws on any other error", async () => {
    state.client = supabaseClientMock({ rpc: { admin_dispatch_order_history: { data: null, error: { message: "admin_dispatch_order_history: order does not exist", code: "P0002" } } } });
    expect(await getDispatchHistory("not-a-uuid")).toBeNull();
    expect(state.client.rpc).not.toHaveBeenCalled();
    expect(await getDispatchHistory(ORDER_ID)).toBeNull();
    state.client = supabaseClientMock({ rpc: { admin_dispatch_order_history: { data: null, error: { message: "boom" } } } });
    await expect(getDispatchHistory(ORDER_ID)).rejects.toThrow("boom");
  });

  it("requires an admin", async () => {
    requireAdminContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(getDispatchHistory(ORDER_ID)).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("dispatch metrics", () => {
  it("reads the last 7 days from the database's default window", async () => {
    state.client = supabaseClientMock({ rpc: { admin_dispatch_metrics: ok({ offers: { made: 4, accepted: 2, accept_rate: 0.5 }, areas: [] }) } });
    expect(await getDispatchMetrics()).toMatchObject({ offersMade: 4, acceptedText: "50% (2)" });
    expect(state.client.rpc).toHaveBeenCalledWith("admin_dispatch_metrics", {});
  });

  it("surfaces a database error", async () => {
    state.client = supabaseClientMock({ rpc: { admin_dispatch_metrics: { data: null, error: { message: "boom" } } } });
    await expect(getDispatchMetrics()).rejects.toThrow("boom");
  });
});
