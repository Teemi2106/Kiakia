import { describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

const VENDOR_ID = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: vi.fn(() => Promise.resolve({ userId: "admin" })) }));
vi.mock("./finance", () => ({
  loadOwnerBalance: vi.fn(() => Promise.resolve(null)),
  loadRecentPayouts: vi.fn(() => Promise.resolve([])),
}));
vi.mock("./orders", () => ({ loadRecentOrders: vi.fn(() => Promise.resolve([])) }));

const state = { items: [] as unknown[] };
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    supabaseClientMock({
      from: {
        vendors: queryBuilder(ok({ id: VENDOR_ID, owner_user_id: "owner" })),
        vendor_staff: queryBuilder(ok([])),
        profiles: queryBuilder(ok([{ id: "cust", full_name: "Ada Obi", phone: null, status: "active" }])),
        menu_categories: queryBuilder(
          ok([
            { id: "c1", category_key: "soups", sort_order: 0, is_active: true },
            { id: "c2", category_key: "drinks", sort_order: 1, is_active: false },
          ]),
        ),
        menu_items: queryBuilder(ok(state.items)),
        order_ratings: queryBuilder(
          ok([{ order_id: "o1", customer_id: "cust", vendor_rating: 4, vendor_comment: "Good", created_at: "2026-01-02T00:00:00Z" }]),
        ),
        orders: queryBuilder(ok([{ id: "o1", code: "KK-1" }])),
      },
    }),
}));

const { getVendorDetail, MENU_ITEM_CAP } = await import("./vendors");

const item = (n: number, category: string | null) => ({
  id: `i${n}`,
  category_id: category,
  name: `Item ${n}`,
  price_kobo: 1000 * n,
  is_available: n % 2 === 0,
  sort_order: n,
});

describe("getVendorDetail menu and ratings", () => {
  it("groups items under their categories, with a bucket for uncategorised items", async () => {
    state.items.splice(0, state.items.length, item(1, "c1"), item(2, "c1"), item(3, null));

    const detail = await getVendorDetail(VENDOR_ID);

    expect(detail?.menu.truncated).toBe(false);
    expect(detail?.menu.categories.map((c) => [c.label, c.isActive, c.items.length])).toEqual([
      ["Soups", true, 2],
      ["Drinks", false, 0],
      ["Uncategorised", true, 1],
    ]);
    expect(detail?.menu.categories[0]?.items[0]).toEqual({ id: "i1", name: "Item 1", priceKobo: 1000, isAvailable: false });
  });

  it("flags truncation when the vendor has more items than the cap and drops the probe row", async () => {
    state.items.splice(0, state.items.length, ...Array.from({ length: MENU_ITEM_CAP + 1 }, (_, n) => item(n, "c1")));

    const detail = await getVendorDetail(VENDOR_ID);

    expect(detail?.menu.truncated).toBe(true);
    expect(detail?.menu.categories[0]?.items).toHaveLength(MENU_ITEM_CAP);
  });

  it("returns recent ratings with the order code and customer name", async () => {
    const detail = await getVendorDetail(VENDOR_ID);

    expect(detail?.recentRatings).toEqual([
      { orderId: "o1", orderCode: "KK-1", rating: 4, comment: "Good", customerName: "Ada Obi", createdAt: "2026-01-02T00:00:00Z" },
    ]);
  });
});
