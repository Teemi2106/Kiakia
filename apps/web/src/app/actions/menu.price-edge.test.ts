import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

// QA sweep: vendor menu price edge cases. The two formerly-failing cases are
// fixed by parseMenuPriceKobo (packages/domain/src/limits.ts) and are now
// ordinary regression tests.

const state = {
  client: { current: supabaseClientMock() },
  adminClient: { current: supabaseClientMock() },
};
const requireVendorContext = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ userId: "u1", email: null, phone: null }),
);
vi.mock("@/lib/auth/dal", () => ({ requireVendorContext: (...args: unknown[]) => requireVendorContext(...args) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(() => Promise.resolve(state.client.current)) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => state.adminClient.current) }));

const { createMenuItemAction } = await import("./menu");

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const MY_VENDOR = "vendor-mine";
let insertedPrice: number | undefined;

beforeEach(() => {
  insertedPrice = undefined;
  state.client.current = supabaseClientMock({ from: { vendor_staff: queryBuilder(ok({ vendor_id: MY_VENDOR })) } });
  state.adminClient.current = {
    from: vi.fn((table: string) => {
      if (table === "menu_items") {
        return {
          insert: vi.fn((row: { price_kobo: number }) => {
            insertedPrice = row.price_kobo;
            return { select: vi.fn(() => ({ single: () => Promise.resolve(ok({ id: "new-item" })) })) };
          }),
        };
      }
      return queryBuilder(ok(null));
    }),
  } as never;
});

async function submit(priceNaira: string) {
  try {
    return await createMenuItemAction({}, formData({ vendorId: MY_VENDOR, name: "Rice", priceNaira }));
  } catch {
    return { error: undefined }; // NEXT_REDIRECT after a successful insert
  }
}

describe("createMenuItemAction price edge cases (QA sweep)", () => {
  it("rounds a whole-kobo price exactly (baseline)", async () => {
    await submit("2500.50");
    expect(insertedPrice).toBe(250050);
  });

  // 0.004 naira used to pass the `<= 0` guard and Math.round to 0 kobo, creating
  // a free item the vendor thought was rejected.
  it("rejects a sub-kobo price that rounds to 0 kobo", async () => {
    const result = await submit("0.004");
    expect(result.error).toBeTruthy();
    expect(insertedPrice).toBeUndefined();
  });

  // 1e13 naira used to be accepted (1e15 kobo); place_order multiplies by qty.
  it("rejects an absurdly large price", async () => {
    const result = await submit("10000000000000");
    expect(result.error).toBeTruthy();
    expect(insertedPrice).toBeUndefined();
  });

  it("rejects NaN and negative prices", async () => {
    expect((await submit("abc")).error).toBeTruthy();
    expect((await submit("-5")).error).toBeTruthy();
    expect(insertedPrice).toBeUndefined();
  });
});
