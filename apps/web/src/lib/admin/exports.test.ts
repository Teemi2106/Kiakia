import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseClientMock } from "@/test/supabase-mock";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const VENDOR_ID = "33333333-3333-4333-8333-333333333333";
const EXPORT_ID = "99999999-9999-4999-8999-999999999999";

const state = { client: supabaseClientMock() };
const session = { userId: ADMIN_ID, email: null, phone: null };
const requireAdminContext = vi.fn(() => Promise.resolve(session));
const requireFinanceContext = vi.fn(() => Promise.resolve(session));
vi.mock("@/lib/auth/dal", () => ({
  requireAdminContext: () => requireAdminContext(),
  requireFinanceContext: () => requireFinanceContext(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));

const { handleOrdersExport, handleLedgerExport, isSameOrigin } = await import("./exports");

const order = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  code: `KK-${n}`,
  created_at: `2026-01-0${n}T10:00:00.123456+00:00`,
  status: "delivered",
  payment_status: "paid",
  vendor_id: VENDOR_ID,
  vendor_name: '@evil, "Co"',
  customer_id: "c1",
  rider_id: null,
  subtotal_kobo: 1000,
  delivery_fee_kobo: 200,
  service_fee_kobo: 50,
  discount_kobo: 0,
  total_kobo: 1250,
  placed_at: "2026-01-01T09:59:00+00:00",
  delivered_at: null,
  ...extra,
});

function post(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request("https://admin.kiakia.test/admin/orders/export", {
    method: "POST",
    headers: { origin: "https://admin.kiakia.test", host: "admin.kiakia.test", "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields),
  });
}

function redirectError(path: string): Error {
  return Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${path};307;` });
}

const range = { from: "2026-01-01", to: "2026-01-31" };

beforeEach(() => {
  requireAdminContext.mockReset().mockResolvedValue(session);
  requireFinanceContext.mockReset().mockResolvedValue(session);
});

describe("isSameOrigin", () => {
  it("compares Origin host to Host / X-Forwarded-Host, and falls back to Sec-Fetch-Site", () => {
    const req = (headers: Record<string, string>) => new Request("https://app.test/x", { method: "POST", headers });
    expect(isSameOrigin(req({ origin: "https://app.test", host: "app.test" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "https://evil.test", host: "app.test" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "https://app.test", host: "internal:3000", "x-forwarded-host": "app.test" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "null", host: "app.test" }))).toBe(false);
    expect(isSameOrigin(req({ host: "app.test" }))).toBe(false);
    expect(isSameOrigin(req({ host: "app.test", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOrigin(req({ host: "app.test", "sec-fetch-site": "cross-site" }))).toBe(false);
  });
});

describe("handleOrdersExport", () => {
  it("refuses a cross-origin POST before touching auth or data", async () => {
    state.client = supabaseClientMock();
    const res = await handleOrdersExport(post(range, { origin: "https://evil.test" }));
    expect(res.status).toBe(403);
    expect(requireAdminContext).not.toHaveBeenCalled();
    expect(state.client.rpc).not.toHaveBeenCalled();
    expect(state.client.from).not.toHaveBeenCalled();
  });

  it("returns 401 for a signed-out caller and 403 for a non-admin, with no audit row and no data", async () => {
    state.client = supabaseClientMock();
    requireAdminContext.mockRejectedValueOnce(redirectError("/login"));
    expect((await handleOrdersExport(post(range))).status).toBe(401);
    requireAdminContext.mockRejectedValueOnce(redirectError("/home"));
    expect((await handleOrdersExport(post(range))).status).toBe(403);
    expect(state.client.rpc).not.toHaveBeenCalled();
    expect(state.client.from).not.toHaveBeenCalled();
  });

  it("rethrows an unexpected DAL failure rather than treating it as a redirect", async () => {
    requireAdminContext.mockRejectedValueOnce(new Error("boom"));
    await expect(handleOrdersExport(post(range))).rejects.toThrow("boom");
  });

  it("only treats a digest with a redirect status (303/307/308) as a redirect", async () => {
    const withStatus = (status: string) => Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;/home;${status};` });
    for (const status of ["303", "307", "308"]) {
      requireAdminContext.mockRejectedValueOnce(withStatus(status));
      expect((await handleOrdersExport(post(range))).status).toBe(403);
    }
    for (const status of ["200", "abc", ""]) {
      requireAdminContext.mockRejectedValueOnce(withStatus(status));
      await expect(handleOrdersExport(post(range))).rejects.toThrow("NEXT_REDIRECT");
    }
  });

  it.each([
    [{ from: "2026-01-01" }, "to is required"],
    [{ from: "2026-01-01", to: "2026-06-01" }, "limited to 92 days"],
    [{ ...range, status: "bogus" }, "unknown order status"],
    [{ ...range, vendorId: "x" }, "uuid"],
  ])("answers 400 with a plain message for %j and writes no audit row", async (fields, message) => {
    state.client = supabaseClientMock({ rpc: { admin_log_export: ok(EXPORT_ID) } });
    const res = await handleOrdersExport(post(fields));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(message);
    expect(state.client.rpc).not.toHaveBeenCalled();
  });

  it("audits first, then streams header + rows with the safe response headers", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(ok(EXPORT_ID))
      .mockResolvedValueOnce(ok([order(1, { code: "=cmd|' /C calc'!A0" }), order(2)]));
    state.client = { ...supabaseClientMock(), rpc } as never;

    const res = await handleOrdersExport(post({ ...range, status: "delivered", vendorId: VENDOR_ID }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="kiakia-orders-2026-01-01_2026-01-31.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-export-id")).toBe(EXPORT_ID);

    expect(rpc).toHaveBeenNthCalledWith(1, "admin_log_export", {
      p_actor_id: ADMIN_ID,
      p_kind: "orders",
      p_filters: { ...range, status: "delivered", vendor_id: VENDOR_ID },
    });
    // The audit call happened before any page read (the body has not been pulled yet).
    expect(rpc).toHaveBeenCalledTimes(1);

    const lines = (await res.text()).split("\r\n");
    expect(lines[0]).toBe(
      "order_code,created_at,status,payment_status,vendor_id,vendor_name,customer_id,rider_id,subtotal_kobo,delivery_fee_kobo,service_fee_kobo,discount_kobo,total_kobo,placed_at,delivered_at",
    );
    expect(lines[1]).toBe(
      `'=cmd|' /C calc'!A0,2026-01-01T10:00:00.123456+00:00,delivered,paid,${VENDOR_ID},"'@evil, ""Co""",c1,,1000,200,50,0,1250,2026-01-01T09:59:00+00:00,`,
    );
    expect(lines[2]?.startsWith("KK-2,")).toBe(true);
    expect(lines[3]).toBe("");

    expect(rpc).toHaveBeenNthCalledWith(2, "admin_export_orders_page", {
      p_actor_id: ADMIN_ID,
      p_from: "2026-01-01T00:00:00.000Z",
      p_to: "2026-02-01T00:00:00.000Z",
      p_status: "delivered",
      p_vendor_id: VENDOR_ID,
      p_after_created_at: null,
      p_after_id: null,
      p_limit: 1000,
    });
    expect(state.client.from).not.toHaveBeenCalled(); // no table reads, no vendor-name lookups
  });

  it("passes the last row as a keyset cursor (not offset) for the second chunk", async () => {
    const big = Array.from({ length: 1000 }, (_, i) => order(1, { id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
    const rpc = vi.fn().mockResolvedValueOnce(ok(EXPORT_ID)).mockResolvedValueOnce(ok(big)).mockResolvedValueOnce(ok([order(2)]));
    state.client = { ...supabaseClientMock(), rpc } as never;

    const res = await handleOrdersExport(post(range));
    const text = await res.text();

    expect(text.split("\r\n")).toHaveLength(1 + 1001 + 1);
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "admin_export_orders_page",
      expect.objectContaining({
        p_status: null,
        p_vendor_id: null,
        p_after_created_at: "2026-01-01T10:00:00.123456+00:00",
        p_after_id: "00000000-0000-4000-8000-000000000999",
      }),
    );
  });

  it("does not stream when the audit write fails", async () => {
    state.client = supabaseClientMock({ rpc: { admin_log_export: fail("db down") } });
    const res = await handleOrdersExport(post(range));
    expect(res.status).toBe(500);
    expect(state.client.from).not.toHaveBeenCalled();
  });

  it.each([
    ["P0001", 403],
    ["42501", 403],
    ["23514", 400],
    ["XX000", 500],
  ])("maps audit RPC code %s to %i and streams nothing", async (code, status) => {
    state.client = supabaseClientMock({ rpc: { admin_log_export: fail("refused", code) } });
    const res = await handleOrdersExport(post(range));
    expect(res.status).toBe(status);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(state.client.from).not.toHaveBeenCalled();
  });

  it("accepts a missing Origin when Sec-Fetch-Site is same-origin and refuses cross-site", async () => {
    state.client = supabaseClientMock({ rpc: { admin_log_export: ok(EXPORT_ID) } });
    const bare = (extra: Record<string, string>) =>
      new Request("https://admin.kiakia.test/admin/orders/export", {
        method: "POST",
        headers: { host: "admin.kiakia.test", "content-type": "application/x-www-form-urlencoded", ...extra },
        body: new URLSearchParams(range),
      });
    expect((await handleOrdersExport(bare({ "sec-fetch-site": "same-origin" }))).status).toBe(200);
    expect((await handleOrdersExport(bare({ "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });
});

describe("handleLedgerExport", () => {
  const entry = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    created_at: `2026-01-0${n}T10:00:00+00:00`,
    transaction_id: "t1",
    transaction_reference: "KK-1-payment",
    transaction_kind: "payment_capture",
    entry_type: "capture",
    account_owner_type: "platform",
    account_kind: "escrow",
    account_owner_id: null,
    direction: "credit",
    amount_kobo: 125_000,
    order_code: "KK-1",
    ...extra,
  });

  it("refuses a non-finance admin: no audit row, no ledger read", async () => {
    state.client = supabaseClientMock();
    requireFinanceContext.mockRejectedValueOnce(redirectError("/admin"));
    const res = await handleLedgerExport(post(range));
    expect(res.status).toBe(403);
    expect(state.client.rpc).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin POST and an invalid range", async () => {
    state.client = supabaseClientMock();
    expect((await handleLedgerExport(post(range, { origin: "https://evil.test" }))).status).toBe(403);
    expect(requireFinanceContext).not.toHaveBeenCalled();
    expect((await handleLedgerExport(post({ from: "2026-01-01", to: "2026-12-31" }))).status).toBe(400);
    expect(state.client.rpc).not.toHaveBeenCalled();
  });

  it("audits, then pages the finance RPC by keyset and writes integer kobo", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(ok(EXPORT_ID))
      .mockResolvedValueOnce(ok([entry(1, { transaction_reference: "=1+1" }), entry(2, { account_owner_id: "v1", direction: "debit" })]));
    state.client = { ...supabaseClientMock(), rpc } as never;

    const res = await handleLedgerExport(post(range));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("kiakia-ledger-2026-01-01_2026-01-31.csv");

    const lines = (await res.text()).split("\r\n");
    expect(lines[0]).toBe(
      "created_at,transaction_id,transaction_reference,transaction_kind,entry_type,account_owner_type,account_kind,owner_id,direction,amount_kobo,order_code",
    );
    expect(lines[1]).toBe("2026-01-01T10:00:00+00:00,t1,'=1+1,payment_capture,capture,platform,escrow,,credit,125000,KK-1");
    expect(lines[2]).toContain(",v1,debit,125000,");

    expect(rpc).toHaveBeenNthCalledWith(1, "admin_log_export", { p_actor_id: ADMIN_ID, p_kind: "ledger", p_filters: range });
    expect(rpc).toHaveBeenNthCalledWith(2, "admin_export_ledger_page", {
      p_actor_id: ADMIN_ID,
      p_from: "2026-01-01T00:00:00.000Z",
      p_to: "2026-02-01T00:00:00.000Z",
      p_after_created_at: null,
      p_after_id: null,
      p_limit: 1000,
    });
  });
});
