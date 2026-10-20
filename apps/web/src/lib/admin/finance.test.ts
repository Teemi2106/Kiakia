import { describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

const OWNER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const state = { client: supabaseClientMock() };

vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: vi.fn(() => Promise.resolve({ userId: ADMIN })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));

const { getMoneySummary, listPayables, listPayoutHistory, loadRecentPayouts, moneyRangeWindow, parseMoneyRange, toMoneySummary } = await import("./finance");

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

const moneyDoc = (over: Record<string, unknown> = {}) => ({
  generated_at: "2026-10-20T12:00:00Z",
  window: { from: null, to: null },
  gross_processed_kobo: 590000,
  gross_processed_card_kobo: 490000,
  gross_processed_wallet_kobo: 100000,
  delivered_gmv_kobo: 590000,
  delivered_orders: 1,
  platform_earnings_kobo: 85000,
  vendor_earned_kobo: 425000,
  rider_earned_kobo: 80000,
  refunded_kobo: 30000,
  refunded_gateway_kobo: 10000,
  refunded_wallet_kobo: 20000,
  paid_out_to_vendors_window_kobo: 100000,
  paid_out_to_riders_window_kobo: 0,
  held_in_escrow_kobo: 200000,
  owed_to_vendors_kobo: 325000,
  owed_to_riders_kobo: 80000,
  paid_out_to_vendors_kobo: 100000,
  paid_out_to_riders_kobo: 0,
  customer_wallet_float_kobo: 140000,
  reconciliation: { captured_kobo: 590000, held_kobo: 0, released_kobo: 590000, refunded_kobo: 0, difference_kobo: 0, ledger_debit_kobo: 1, ledger_credit_kobo: 1, reconciles: true },
  ...over,
});

describe("toMoneySummary", () => {
  it("maps every figure from the RPC document to camelCase kobo", () => {
    expect(toMoneySummary(moneyDoc())).toEqual({
      generatedAt: "2026-10-20T12:00:00Z",
      processedKobo: 590000,
      processedCardKobo: 490000,
      processedWalletKobo: 100000,
      deliveredGmvKobo: 590000,
      deliveredOrders: 1,
      platformEarningsKobo: 85000,
      vendorEarnedKobo: 425000,
      riderEarnedKobo: 80000,
      refundedKobo: 30000,
      refundedGatewayKobo: 10000,
      refundedWalletKobo: 20000,
      paidToVendorsInWindowKobo: 100000,
      paidToRidersInWindowKobo: 0,
      heldInEscrowKobo: 200000,
      owedToVendorsKobo: 325000,
      owedToRidersKobo: 80000,
      paidToVendorsKobo: 100000,
      paidToRidersKobo: 0,
      customerWalletKobo: 140000,
      reconciliation: { reconciles: true, differenceKobo: 0, capturedKobo: 590000, heldKobo: 0, releasedKobo: 590000, refundedKobo: 0 },
    });
  });

  it("keeps a real zero as zero and carries a failed reconciliation", () => {
    const summary = toMoneySummary(
      moneyDoc({ gross_processed_kobo: 0, reconciliation: { captured_kobo: 0, held_kobo: 777, released_kobo: 0, refunded_kobo: 0, difference_kobo: -777, reconciles: false } }),
    );
    expect(summary.processedKobo).toBe(0);
    expect(summary.reconciliation).toMatchObject({ reconciles: false, differenceKobo: -777 });
  });

  it("refuses a document with a missing figure rather than showing it as zero", () => {
    const { owed_to_riders_kobo: _omitted, ...rest } = moneyDoc();
    expect(() => toMoneySummary(rest)).toThrow(/owed_to_riders_kobo/);
    expect(() => toMoneySummary(null)).toThrow(/unexpected response/);
    expect(() => toMoneySummary(moneyDoc({ reconciliation: undefined }))).toThrow(/reconciliation/);
  });
});

describe("parseMoneyRange / moneyRangeWindow", () => {
  const now = new Date("2026-10-20T16:30:00Z");

  it("defaults to all time for a missing or unknown range", () => {
    expect(parseMoneyRange(undefined)).toBe("all");
    expect(parseMoneyRange("forever")).toBe("all");
    expect(parseMoneyRange("7d")).toBe("7d");
    expect(parseMoneyRange("all")).toBe("all");
  });

  it("turns each range into an open-ended window", () => {
    expect(moneyRangeWindow("all", now)).toEqual({ from: null, to: null });
    expect(moneyRangeWindow("7d", now)).toEqual({ from: "2026-10-13T16:30:00.000Z", to: null });
    expect(moneyRangeWindow("30d", now)).toEqual({ from: "2026-09-20T16:30:00.000Z", to: null });
  });

  it("starts today at midnight Nigerian time (UTC+1)", () => {
    expect(moneyRangeWindow("today", now)).toEqual({ from: "2026-10-19T23:00:00.000Z", to: null });
    // 23:30 UTC is already tomorrow in Lagos.
    expect(moneyRangeWindow("today", new Date("2026-10-20T23:30:00Z"))).toEqual({ from: "2026-10-20T23:00:00.000Z", to: null });
  });
});

describe("getMoneySummary", () => {
  it("calls the RPC with the range's window and maps the result", async () => {
    state.client = supabaseClientMock({ rpc: { admin_money_summary: ok(moneyDoc()) } });
    const summary = await getMoneySummary("all");
    expect(state.client.rpc).toHaveBeenCalledWith("admin_money_summary", { p_from: null, p_to: null });
    expect(summary.platformEarningsKobo).toBe(85000);
  });

  it("surfaces an RPC error", async () => {
    state.client = supabaseClientMock({ rpc: { admin_money_summary: { data: null, error: { message: "boom" } } } as never });
    await expect(getMoneySummary("30d")).rejects.toThrow("boom");
  });
});
