import { describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

const state = { client: supabaseClientMock() };
const requireAdminContext = vi.fn(() => Promise.resolve({ userId: "admin" }));
vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: () => requireAdminContext() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));

const { countWaitingForRider, getDispatchSettings, getWaitingForOrder, listRecentDispatchChanges, listWaitingForRider, toDispatchValues } = await import("./dispatch");

const settingsRows = [
  { key: "dispatch_radius_m", value_int: 5000, updated_at: "2026-10-01T00:00:00Z", updated_by: "u1" },
  { key: "dispatch_max_riders", value_int: 5, updated_at: "2026-10-01T00:00:00Z", updated_by: null },
  { key: "dispatch_widen_after_seconds", value_int: 120, updated_at: "2026-10-01T00:00:00Z", updated_by: null },
  { key: "dispatch_notify_vendor_after_seconds", value_int: 45, updated_at: "2026-10-01T00:00:00Z", updated_by: null },
  { key: "service_fee_bps", value_int: 250, updated_at: "2026-10-01T00:00:00Z", updated_by: null },
];
const profiles = queryBuilder(ok([{ id: "u1", full_name: "Ada Admin", phone: null, status: "active" }]));

const payload = {
  settings: { radius_m: 5000 },
  online_riders: 1,
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
    { order_id: "o2", code: "KK-2", waiting_since: new Date(Date.now() - 300_000).toISOString(), reason: "offers_pending", offers_open: 2 },
  ],
};

describe("dispatch settings", () => {
  it("reads only dispatch keys with who changed them, and derives the values", async () => {
    state.client = supabaseClientMock({ from: { platform_settings: queryBuilder(ok(settingsRows)), profiles } });
    const settings = await getDispatchSettings();
    expect(settings.rows.map((row) => row.key)).toEqual(["dispatch_radius_m", "dispatch_max_riders", "dispatch_widen_after_seconds", "dispatch_notify_vendor_after_seconds"]);
    expect(settings.rows[0]?.updatedByName).toBe("Ada Admin");
    expect(settings.values).toEqual({ radiusM: 5000, maxRiders: 5, widenAfterSeconds: 120, notifyVendorAfterSeconds: 45 });
  });

  it("falls back to the migration defaults when a row is missing", () => {
    expect(toDispatchValues([])).toEqual({ radiusM: 0, maxRiders: 10, widenAfterSeconds: 60, notifyVendorAfterSeconds: 45 });
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

  it("the tile count and the page come from the same call", async () => {
    state.client = supabaseClientMock({ rpc: { admin_dispatch_status: ok(payload) } });
    expect(await countWaitingForRider()).toBe(2);
    expect(await getWaitingForOrder("o2")).toMatchObject({ reason: "offers_pending", offersOpen: 2 });
    expect(await getWaitingForOrder("nope")).toBeNull();
  });

  it("is empty when nothing is stuck", async () => {
    state.client = supabaseClientMock({ rpc: { admin_dispatch_status: ok({ settings: {}, online_riders: 0, stuck_orders: [] }) } });
    expect(await listWaitingForRider()).toEqual([]);
  });

  it("surfaces a database error", async () => {
    state.client = supabaseClientMock({ rpc: { admin_dispatch_status: { data: null, error: { message: "boom" } } } });
    await expect(listWaitingForRider()).rejects.toThrow("boom");
  });
});
