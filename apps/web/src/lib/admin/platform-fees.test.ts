import { describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";
import { platformFeeExample } from "./platform-fee-info";

const state = { client: supabaseClientMock() };
const requireAdminContext = vi.fn(() => Promise.resolve({ userId: "admin" }));
vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: () => requireAdminContext() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));

const { getPlatformFees, listRecentFeeChanges } = await import("./platform-fees");

describe("getPlatformFees", () => {
  it("returns the known fees as basis points with who last changed them, ignoring unknown keys", async () => {
    state.client = supabaseClientMock({
      from: {
        platform_settings: queryBuilder(
          ok([
            { key: "service_fee_bps", value_int: 250, updated_at: "2026-10-01T00:00:00Z", updated_by: "u1" },
            { key: "default_vendor_commission_bps", value_int: 1500, updated_at: "2026-10-01T00:00:00Z", updated_by: null },
            { key: "something_else", value_int: 1, updated_at: "2026-10-01T00:00:00Z", updated_by: null },
          ]),
        ),
        profiles: queryBuilder(ok([{ id: "u1", full_name: "Ngozi Finance", phone: null, status: "active" }])),
      },
    });

    expect(await getPlatformFees()).toEqual([
      { key: "service_fee_bps", valueBps: 250, updatedAt: "2026-10-01T00:00:00Z", updatedByName: "Ngozi Finance" },
      { key: "default_vendor_commission_bps", valueBps: 1500, updatedAt: "2026-10-01T00:00:00Z", updatedByName: null },
    ]);
  });

  it("requires an admin", async () => {
    requireAdminContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(getPlatformFees()).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("listRecentFeeChanges", () => {
  it("extracts before/after for platform fee changes only", async () => {
    state.client = supabaseClientMock({
      from: {
        admin_audit_log: queryBuilder(
          ok([
            { id: "1", actor_id: "u1", action: "platform_fee.set", reason: "Launch", details: { key: "service_fee_bps", from: 200, to: 500 }, created_at: "2026-10-02T00:00:00Z" },
            { id: "2", actor_id: "u1", action: "service_area.update", reason: "Fuel", details: { name: "Abuja" }, created_at: "2026-10-01T00:00:00Z" },
          ]),
        ),
        profiles: queryBuilder(ok([{ id: "u1", full_name: "Ngozi Finance", phone: null, status: "active" }])),
      },
    });

    const changes = await listRecentFeeChanges();
    expect(changes[0]).toMatchObject({ actorName: "Ngozi Finance", reason: "Launch", change: { key: "service_fee_bps", from: 200, to: 500 } });
    expect(changes[1]?.change).toBeNull();
  });
});

describe("platformFeeExample", () => {
  const format = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG")}.00`;
  it("matches the service fee place_order() would charge on 5,000", () => {
    expect(platformFeeExample("service_fee_bps", 200, format)).toBe("On a ₦5,000 order the service fee is ₦100.");
    expect(platformFeeExample("service_fee_bps", 0, format)).toBe("On a ₦5,000 order the service fee is ₦0.");
  });
  it("words the default commission example for a vendor", () => {
    expect(platformFeeExample("default_vendor_commission_bps", 1500, format)).toBe("On ₦5,000 of food sales a new vendor pays ₦750 commission.");
  });
});
