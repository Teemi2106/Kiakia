import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseClientMock, type QueryResult } from "@/test/supabase-mock";

const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const RIDER_ID = "33333333-3333-4333-8333-333333333333";
const state = { client: supabaseClientMock() };

vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: vi.fn(() => Promise.resolve({ userId: "admin" })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));

const { listAssignableRiders } = await import("./orders");

function useRpc(result: QueryResult) {
  state.client = supabaseClientMock({ rpc: { admin_list_assignable_riders: result } });
  return state.client.rpc;
}

beforeEach(() => {
  state.client = supabaseClientMock();
});

describe("listAssignableRiders", () => {
  it("maps the RPC rows, keeping the quoted fee exactly", async () => {
    const rpc = useRpc(
      ok([{ rider_id: RIDER_ID, full_name: "Ada Obi", phone: "08012345678", pickup_distance_m: 549, rider_fee_kobo: 65000, last_ping_at: "2026-01-01T10:00:00Z" }]),
    );

    expect(await listAssignableRiders(ORDER_ID, 5)).toEqual([
      { riderId: RIDER_ID, fullName: "Ada Obi", phone: "08012345678", pickupDistanceM: 549, riderFeeKobo: 65000, lastPingAt: "2026-01-01T10:00:00Z" },
    ]);
    expect(rpc).toHaveBeenCalledWith("admin_list_assignable_riders", { p_order_id: ORDER_ID, p_limit: 5 });
  });

  it("returns nothing for a malformed id without calling the database", async () => {
    const rpc = useRpc(ok([]));
    expect(await listAssignableRiders("nope")).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws on a database error so the admin error boundary handles it", async () => {
    useRpc(fail("boom"));
    await expect(listAssignableRiders(ORDER_ID)).rejects.toThrow("boom");
  });
});
