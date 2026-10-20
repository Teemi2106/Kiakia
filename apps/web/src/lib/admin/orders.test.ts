import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, queryBuilder, supabaseClientMock, type QueryResult } from "@/test/supabase-mock";

const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const RIDER_ID = "33333333-3333-4333-8333-333333333333";
const state = { client: supabaseClientMock() };

vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: vi.fn(() => Promise.resolve({ userId: "admin" })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));

const { listAssignableRiders, listOrders } = await import("./orders");

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

describe("listOrders paging with an estimated count", () => {
  const VENDOR_ID = "44444444-4444-4444-8444-444444444444";
  const row = (n: number) => ({
    id: `o${n}`,
    code: `KK-${n}`,
    status: "delivered",
    payment_status: "paid",
    total_kobo: 1000,
    created_at: "2026-01-01T00:00:00Z",
    vendor_id: VENDOR_ID,
    customer_id: "c1",
    rider_id: null,
  });

  /** An orders builder that records .range() and reports `count` like PostgREST. */
  function useOrders(rows: unknown[], count: number | null) {
    const orders = queryBuilder(ok(rows));
    const range = vi.fn(() => orders);
    orders.range = range;
    orders.then = (resolve: (r: unknown) => unknown) => Promise.resolve({ data: rows, error: null, count }).then(resolve);
    state.client = supabaseClientMock({ from: { orders, vendors: queryBuilder(ok([])), profiles: queryBuilder(ok([])) } });
    return range;
  }

  it("fetches one extra row, returns only the page, and reports hasNext", async () => {
    const range = useOrders([row(1), row(2), row(3)], 3);
    const page = await listOrders({ pageSize: 2 });
    expect(range).toHaveBeenCalledWith(0, 2);
    expect(page.rows.map((r) => r.code)).toEqual(["KK-1", "KK-2"]);
    expect(page.hasNext).toBe(true);
    expect(page.approximateTotal).toBe(false);
  });

  it("reports no next page on the last page, even when the estimate says otherwise", async () => {
    const range = useOrders([row(3)], 5000);
    const page = await listOrders({ pageSize: 2, page: 2 });
    expect(range).toHaveBeenCalledWith(2, 4);
    expect(page.rows).toHaveLength(1);
    expect(page.hasNext).toBe(false);
    expect(page.total).toBe(5000);
    expect(page.approximateTotal).toBe(true);
  });

  it("an empty result has no next page", async () => {
    useOrders([], 0);
    expect(await listOrders({})).toMatchObject({ rows: [], total: 0, hasNext: false });
  });
});
