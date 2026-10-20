import { describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

const OWNER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const state = { client: supabaseClientMock() };

vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: vi.fn(() => Promise.resolve({ userId: ADMIN })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));

const { listPayables, listPayoutHistory, loadRecentPayouts } = await import("./finance");

const payoutRow = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  actor_id: ADMIN,
  reason: "Weekly",
  details: { external_reference: "BANK-1", amount_kobo: 250000, transaction_id: "t1" },
  created_at: "2026-02-01T10:00:00Z",
  target_type: "vendor",
  target_id: OWNER,
  ...over,
});

const admin = { id: ADMIN, full_name: "Ngozi Admin", phone: null, status: "active" };

describe("listPayables", () => {
  it("maps the rows, masks the rider's account number and carries the total owed from the first row", async () => {
    state.client = supabaseClientMock({
      rpc: {
        admin_list_payables: ok([
          { owner_type: "rider", owner_id: "r1", display_name: "Tunde", balance_kobo: 90000, disbursed_kobo: 0, bank_name: "GTBank", bank_account_name: "Tunde A", bank_account_number: "0123456789", total_count: 2, total_owed_kobo: 140000 },
          { owner_type: "vendor", owner_id: "v1", display_name: "Mama Put", balance_kobo: 50000, disbursed_kobo: 10000, bank_name: null, bank_account_name: null, bank_account_number: null, total_count: 2, total_owed_kobo: 140000 },
        ]),
      },
    });

    const page = await listPayables({ page: 2, pageSize: 2 });

    expect(state.client.rpc).toHaveBeenCalledWith("admin_list_payables", { p_limit: 2, p_offset: 2 });
    expect(page.total).toBe(2);
    expect(page.totalOwedKobo).toBe(140000);
    expect(page.rows[0]?.bank).toEqual({ bankName: "GTBank", accountName: "Tunde A", maskedNumber: "******6789" });
    expect(JSON.stringify(page)).not.toContain("0123456789");
    expect(page.rows[1]).toMatchObject({ ownerType: "vendor", displayName: "Mama Put", balanceKobo: 50000, disbursedKobo: 10000, bank: null });
  });

  it("is empty with a zero total when nobody is owed", async () => {
    state.client = supabaseClientMock({ rpc: { admin_list_payables: ok([]) } });
    expect(await listPayables()).toMatchObject({ rows: [], total: 0, totalOwedKobo: 0 });
  });
});

describe("loadRecentPayouts", () => {
  it("reads the owner's payout.record audit rows with who recorded them, and drops rows without a reference or amount", async () => {
    const audit = queryBuilder(ok([payoutRow(), payoutRow({ id: "a2", details: { note: "unrelated" } })]));
    state.client = supabaseClientMock({ from: { admin_audit_log: audit, profiles: queryBuilder(ok([admin])) } });

    const payouts = await loadRecentPayouts(state.client as never, "vendor", OWNER);

    expect(audit.eq).toHaveBeenCalledWith("action", "payout.record");
    expect(audit.eq).toHaveBeenCalledWith("target_type", "vendor");
    expect(audit.eq).toHaveBeenCalledWith("target_id", OWNER);
    expect(payouts).toEqual([
      { auditId: "a1", reference: "BANK-1", amountKobo: 250000, createdAt: "2026-02-01T10:00:00Z", recordedBy: "Ngozi Admin", note: "Weekly" },
    ]);
  });
});

describe("listPayoutHistory", () => {
  it("names the vendor or rider each payout went to", async () => {
    state.client = supabaseClientMock({
      from: {
        admin_audit_log: queryBuilder(ok([payoutRow(), payoutRow({ id: "a3", target_type: "rider", target_id: "r1" })])),
        profiles: queryBuilder(ok([admin, { id: "r1", full_name: "Tunde", phone: null, status: "active" }])),
        vendors: queryBuilder(ok([{ id: OWNER, name: "Mama Put" }])),
      },
    });

    const page = await listPayoutHistory();

    expect(page.rows.map((row) => [row.ownerType, row.ownerName, row.amountKobo, row.recordedBy])).toEqual([
      ["vendor", "Mama Put", 250000, "Ngozi Admin"],
      ["rider", "Tunde", 250000, "Ngozi Admin"],
    ]);
  });
});
