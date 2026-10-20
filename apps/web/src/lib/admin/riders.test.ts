import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

const RIDER_ID = "22222222-2222-4222-8222-222222222222";
const finance = { allowed: false };

vi.mock("@/lib/auth/dal", () => ({
  requireAdminContext: vi.fn(() => Promise.resolve({ userId: "admin" })),
  canManageFinance: vi.fn(() => Promise.resolve(finance.allowed)),
}));
vi.mock("./finance", () => ({
  loadOwnerBalance: vi.fn(() => Promise.resolve(null)),
  loadRecentPayouts: vi.fn(() => Promise.resolve([])),
}));
vi.mock("./orders", () => ({ loadRecentOrders: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    supabaseClientMock({
      from: {
        riders: queryBuilder(
          ok({
            user_id: RIDER_ID,
            bank_name: "GTBank",
            bank_account_name: "Ada Obi",
            bank_account_number: "0123456789",
          }),
        ),
        rider_documents: queryBuilder(ok([])),
        profiles: queryBuilder(ok([])),
        order_ratings: queryBuilder(
          ok([
            { order_id: "o1", rider_rating: 5, rider_comment: "Quick", created_at: "2026-01-02T00:00:00Z" },
            { order_id: "o2", rider_rating: null, rider_comment: null, created_at: "2026-01-01T00:00:00Z" },
          ]),
        ),
        orders: queryBuilder(ok([{ id: "o1", code: "KK-1" }])),
      },
    }),
}));

const { getRiderDetail } = await import("./riders");

beforeEach(() => {
  finance.allowed = false;
});

describe("getRiderDetail bank details", () => {
  it("masks the account number for a non-finance admin and keeps it out of the payload", async () => {
    const detail = await getRiderDetail(RIDER_ID);

    expect(detail?.bank).toEqual({ bankName: "GTBank", accountName: "Ada Obi", maskedNumber: "******6789" });
    expect(JSON.stringify(detail)).not.toContain("0123456789");
  });

  it("includes the full account number for a finance admin", async () => {
    finance.allowed = true;
    const detail = await getRiderDetail(RIDER_ID);

    expect(detail?.bank).toMatchObject({ maskedNumber: "******6789", fullNumber: "0123456789" });
  });
});

describe("getRiderDetail recentRatings", () => {
  it("maps ratings with the order code and drops rows without a rider rating", async () => {
    const detail = await getRiderDetail(RIDER_ID);

    expect(detail?.recentRatings).toEqual([
      { orderId: "o1", orderCode: "KK-1", rating: 5, comment: "Quick", createdAt: "2026-01-02T00:00:00Z" },
    ]);
  });
});
