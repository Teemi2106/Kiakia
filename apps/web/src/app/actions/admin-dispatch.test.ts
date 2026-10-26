import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, queryBuilder, supabaseClientMock, type QueryResult } from "@/test/supabase-mock";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";

const state = { adminClient: supabaseClientMock() };
const adminSession = { userId: ADMIN_ID, email: null, phone: null };
const requireAdminContext = vi.fn(() => Promise.resolve(adminSession));
vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: () => requireAdminContext() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => state.adminClient) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { redispatchOrderAction, setDispatchSettingAction } = await import("./admin-dispatch");

const settingsRows = [
  { key: "dispatch_radius_m", value_int: 5000, updated_at: "2026-10-01T00:00:00Z", updated_by: null },
  { key: "dispatch_max_riders", value_int: 5, updated_at: "2026-10-01T00:00:00Z", updated_by: null },
  { key: "dispatch_widen_after_seconds", value_int: 120, updated_at: "2026-10-01T00:00:00Z", updated_by: null },
  { key: "dispatch_notify_vendor_after_seconds", value_int: 45, updated_at: "2026-10-01T00:00:00Z", updated_by: null },
];

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

function useClient(rpc: Record<string, QueryResult>) {
  state.adminClient = supabaseClientMock({
    rpc,
    from: { platform_settings: queryBuilder(ok(settingsRows)), profiles: queryBuilder(ok([])) },
  });
  return state.adminClient.rpc;
}

const base = { key: "dispatch_radius_m", value: "8", reason: "A rider was 8.5 km away" };

beforeEach(() => {
  requireAdminContext.mockReset();
  requireAdminContext.mockResolvedValue(adminSession);
  revalidatePath.mockReset();
});

describe("setDispatchSettingAction", () => {
  it("converts km to metres, takes the actor from the session and revalidates", async () => {
    const rpc = useClient({ admin_set_dispatch_setting: ok({}) });
    const result = await setDispatchSettingAction({}, formData(base));
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/orders from now on/);
    expect(rpc).toHaveBeenCalledWith("admin_set_dispatch_setting", {
      p_key: "dispatch_radius_m",
      p_value: 8000,
      p_reason: "A rider was 8.5 km away",
      p_actor_id: ADMIN_ID,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/dispatch");
  });

  it("converts minutes to seconds and accepts 0 for never", async () => {
    const rpc = useClient({ admin_set_dispatch_setting: ok({}) });
    await setDispatchSettingAction({}, formData({ ...base, key: "dispatch_widen_after_seconds", value: "3" }));
    await setDispatchSettingAction({}, formData({ ...base, key: "dispatch_widen_after_seconds", value: "0" }));
    expect(rpc).toHaveBeenNthCalledWith(1, "admin_set_dispatch_setting", expect.objectContaining({ p_value: 180 }));
    expect(rpc).toHaveBeenNthCalledWith(2, "admin_set_dispatch_setting", expect.objectContaining({ p_value: 0 }));
  });

  it("accepts 0 for no distance limit", async () => {
    const rpc = useClient({ admin_set_dispatch_setting: ok({}) });
    await setDispatchSettingAction({}, formData({ ...base, value: "0" }));
    expect(rpc).toHaveBeenCalledWith("admin_set_dispatch_setting", expect.objectContaining({ p_value: 0 }));
  });

  it("accepts the notify-the-store delay in minutes", async () => {
    const rpc = useClient({ admin_set_dispatch_setting: ok({}) });
    await setDispatchSettingAction({}, formData({ ...base, key: "dispatch_notify_vendor_after_seconds", value: "1" }));
    expect(rpc).toHaveBeenCalledWith("admin_set_dispatch_setting", expect.objectContaining({ p_key: "dispatch_notify_vendor_after_seconds", p_value: 60 }));
  });

  it.each([
    ["dispatch_offer_timeout_seconds", "45", 45],
    ["dispatch_h3_resolution", "9", 9],
    ["dispatch_h3_initial_ring", "0", 0],
    ["dispatch_default_travel_seconds", "10", 600],
    ["dispatch_road_factor_pct", "135", 135],
    ["dispatch_vendor_arrival_radius_m", "100", 100],
  ])("accepts the sequential-dispatch setting %s = %s (stored as %d)", async (key, value, stored) => {
    const rpc = useClient({ admin_set_dispatch_setting: ok({}) });
    expect((await setDispatchSettingAction({}, formData({ ...base, key, value }))).success).toBe(true);
    expect(rpc).toHaveBeenCalledWith("admin_set_dispatch_setting", expect.objectContaining({ p_key: key, p_value: stored }));
  });

  it.each([
    ["dispatch_offer_timeout_seconds", "14"],
    ["dispatch_offer_timeout_seconds", "121"],
    ["dispatch_h3_resolution", "10"],
    ["dispatch_h3_max_ring", "0"],
    ["dispatch_road_factor_pct", "99"],
    ["dispatch_default_speed_kmh", "4"],
  ])("rejects %s = %s before the RPC", async (key, value) => {
    const rpc = useClient({ admin_set_dispatch_setting: ok({}) });
    expect((await setDispatchSettingAction({}, formData({ ...base, key, value }))).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's first-search-vs-furthest-search refusal", async () => {
    useClient({ admin_set_dispatch_setting: fail("admin_set_dispatch_setting: dispatch_h3_initial_ring (9) cannot be larger than dispatch_h3_max_ring (8)", "23514") });
    expect((await setDispatchSettingAction({}, formData({ ...base, key: "dispatch_h3_initial_ring", value: "9" }))).error).toContain("cannot be larger");
  });

  it("no longer knows a global widened distance", async () => {
    const rpc = useClient({ admin_set_dispatch_setting: ok({}) });
    const result = await setDispatchSettingAction({}, formData({ ...base, key: "dispatch_widened_radius_m", value: "10" }));
    expect(result.error).toBe("Unknown setting");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["dispatch_radius_m", "abc"],
    ["dispatch_radius_m", ""],
    ["dispatch_radius_m", "0.5"],
    ["dispatch_radius_m", "60"],
    ["dispatch_max_riders", "0"],
    ["dispatch_max_riders", "2.5"],
    ["dispatch_max_riders", "99"],
    ["made_up", "5"],
  ])("rejects %s = %j before the RPC", async (key, value) => {
    const rpc = useClient({ admin_set_dispatch_setting: ok({}) });
    const result = await setDispatchSettingAction({}, formData({ ...base, key, value }));
    expect(result.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    const rpc = useClient({ admin_set_dispatch_setting: ok({}) });
    expect((await setDispatchSettingAction({}, formData({ ...base, reason: " " }))).error).toMatch(/reason/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("re-checks the admin role on the server", async () => {
    const rpc = useClient({ admin_set_dispatch_setting: ok({}) });
    requireAdminContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(setDispatchSettingAction({}, formData(base))).rejects.toThrow("NEXT_REDIRECT");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turns a permission refusal into a plain 'ask' message", async () => {
    useClient({ admin_set_dispatch_setting: fail("not allowed", "42501") });
    expect((await setDispatchSettingAction({}, formData(base))).error).toBe("Only admins can change rider matching. Ask an admin or a superadmin to do it.");
  });

  it("passes the database's own range message through and hides unknown errors", async () => {
    useClient({ admin_set_dispatch_setting: fail("admin_set_dispatch_setting: the dispatch radius must be 0 (no limit) or between 1000 and 50000 metres, got 60000", "23514") });
    expect((await setDispatchSettingAction({}, formData(base))).error).toBe("the dispatch radius must be 0 (no limit) or between 1000 and 50000 metres, got 60000");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    useClient({ admin_set_dispatch_setting: fail("relation platform_settings exists", "XX000") });
    expect((await setDispatchSettingAction({}, formData(base))).error).toBe("Something went wrong. Please try again.");
  });
});

describe("redispatchOrderAction", () => {
  it("reports that a rider is being asked now", async () => {
    const rpc = useClient({ admin_redispatch_order: ok({ offers_created: 1, riders_in_range: 4, outcome: "offered", live_offer: false }) });
    const result = await redispatchOrderAction({}, formData({ orderId: ORDER_ID }));
    expect(result).toEqual({ success: true, message: "Asking 1 rider now." });
    expect(rpc).toHaveBeenCalledWith("admin_redispatch_order", expect.objectContaining({ p_order_id: ORDER_ID, p_actor_id: ADMIN_ID }));
    expect(revalidatePath).toHaveBeenCalledWith("/admin/dispatch");
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/orders/${ORDER_ID}`);
  });

  it("says a rider is already being asked when a live offer was kept", async () => {
    useClient({ admin_redispatch_order: ok({ offers_created: 0, riders_in_range: 4, live_offer: true }) });
    const result = await redispatchOrderAction({}, formData({ orderId: ORDER_ID }));
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/^A rider is already being asked/);
  });

  it("says 'No riders in range' when none were offered", async () => {
    useClient({ admin_redispatch_order: ok({ offers_created: 0, riders_in_range: 0 }) });
    const result = await redispatchOrderAction({}, formData({ orderId: ORDER_ID }));
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/^No riders in range/);
  });

  it("rejects a bad order id and re-checks the role", async () => {
    const rpc = useClient({ admin_redispatch_order: ok({ offers_created: 1 }) });
    expect((await redispatchOrderAction({}, formData({ orderId: "nope" }))).error).toBeTruthy();
    requireAdminContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(redispatchOrderAction({}, formData({ orderId: ORDER_ID }))).rejects.toThrow("NEXT_REDIRECT");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores a second click while the first is still running", async () => {
    let release: (value: QueryResult) => void = () => undefined;
    const rpc = vi.fn(() => new Promise<QueryResult>((resolve) => (release = resolve)));
    state.adminClient = { ...supabaseClientMock(), rpc } as never;
    const first = redispatchOrderAction({}, formData({ orderId: ORDER_ID }));
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    const second = await redispatchOrderAction({}, formData({ orderId: ORDER_ID }));
    expect(second.error).toMatch(/already being sent/);
    expect(rpc).toHaveBeenCalledTimes(1);
    release(ok({ offers_created: 2 }));
    expect((await first).message).toBe("Asking 2 riders now.");
    useClient({ admin_redispatch_order: ok({ offers_created: 1 }) });
    expect((await redispatchOrderAction({}, formData({ orderId: ORDER_ID }))).success).toBe(true);
  });

  it("shows the database's plain message when the RPC refuses", async () => {
    useClient({ admin_redispatch_order: fail("admin_redispatch_order: order KK-1 already has a rider", "23514") });
    expect((await redispatchOrderAction({}, formData({ orderId: ORDER_ID }))).error).toBe("order KK-1 already has a rider");
  });
});
