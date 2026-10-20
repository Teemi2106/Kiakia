import { describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

const state = { client: supabaseClientMock() };

vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: vi.fn(() => Promise.resolve({ userId: "admin" })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));
vi.mock("./finance", () => ({ loadOwnerBalance: vi.fn(), loadRecentPayouts: vi.fn() }));
vi.mock("./orders", () => ({ loadRecentOrders: vi.fn() }));

const { listVendors, countVendorsByStatus } = await import("./vendors");

describe("listVendors search", () => {
  it("also matches the owner's name or phone, so an account that is both a customer and a vendor is found", async () => {
    const vendors = queryBuilder(ok([]));
    state.client = supabaseClientMock({ from: { vendors, profiles: queryBuilder(ok([{ id: "owner-1" }, { id: "owner-2" }])) } });

    await listVendors({ q: "Ada" });

    expect(vendors.or).toHaveBeenCalledWith("name.ilike.%Ada%,owner_user_id.in.(owner-1,owner-2)");
  });

  it("falls back to the store name alone when no owner matches", async () => {
    const vendors = queryBuilder(ok([]));
    state.client = supabaseClientMock({ from: { vendors, profiles: queryBuilder(ok([])) } });

    await listVendors({ q: "Ada" });

    expect(vendors.or).toHaveBeenCalledWith("name.ilike.%Ada%");
  });
});

describe("countVendorsByStatus", () => {
  it("returns one count per status", async () => {
    const counts = [3, 20, 1];
    let call = 0;
    state.client = supabaseClientMock({ from: { vendors: queryBuilder(ok(null)) } });
    state.client.from.mockImplementation(() => {
      const builder = queryBuilder(ok(null));
      const result = { data: null, error: null, count: counts[call++] };
      builder.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result).then(onFulfilled);
      return builder;
    });

    expect(await countVendorsByStatus()).toEqual({ pending: 3, active: 20, suspended: 1 });
  });
});
