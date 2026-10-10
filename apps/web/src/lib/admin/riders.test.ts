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
