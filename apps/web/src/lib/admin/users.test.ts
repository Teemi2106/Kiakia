import { describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const state = { client: supabaseClientMock() };

vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: vi.fn(() => Promise.resolve({ userId: "admin" })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));
vi.mock("./finance", () => ({ loadOwnerBalance: vi.fn(() => Promise.resolve(null)) }));
vi.mock("./orders", () => ({ loadRecentOrders: vi.fn(() => Promise.resolve([])) }));

const { listUsers, listCustomers, getUserDetail } = await import("./users");

describe("listUsers", () => {
  const row = {
    id: USER_ID,
    full_name: "Ada Obi",
    phone: "0801",
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    roles: ["customer", "rider"],
    total_count: 41,
  };

  it("calls admin_list_users once with the filters and page window, and maps the rows", async () => {
    state.client = supabaseClientMock({ rpc: { admin_list_users: ok([row]) } });

    const page = await listUsers({ q: "  50%_off ", status: "active", role: "rider", page: 3, pageSize: 10 });

    expect(state.client.rpc).toHaveBeenCalledTimes(1);
    expect(state.client.rpc).toHaveBeenCalledWith("admin_list_users", {
      p_q: "50%_off",
      p_status: "active",
      p_role: "rider",
      p_limit: 10,
      p_offset: 20,
    });
    expect(state.client.from).not.toHaveBeenCalled();
    expect(page).toEqual({
      rows: [{ id: USER_ID, fullName: "Ada Obi", phone: "0801", status: "active", roles: ["customer", "rider"], createdAt: "2026-01-01T00:00:00Z" }],
      total: 41,
      page: 3,
      pageSize: 10,
    });
  });

  it("reads total_count with a one-row follow-up when the requested page is past the end", async () => {
    state.client = supabaseClientMock({ rpc: { admin_list_users: ok([]) } });
    state.client.rpc.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([row]));

    const page = await listUsers({ page: 9, pageSize: 10 });

    expect(state.client.rpc).toHaveBeenCalledTimes(2);
    expect(state.client.rpc).toHaveBeenNthCalledWith(2, "admin_list_users", { p_q: null, p_status: null, p_role: null, p_limit: 1, p_offset: 0 });
    expect(page.rows).toEqual([]);
    expect(page.total).toBe(41);
  });

  it("treats unknown status/role values as no filter and a genuinely empty result as total 0 without a follow-up", async () => {
    state.client = supabaseClientMock({ rpc: { admin_list_users: ok([]) } });

    const page = await listUsers({ status: "bogus", role: "customer", q: "   " });

    expect(state.client.rpc).toHaveBeenCalledWith("admin_list_users", { p_q: null, p_status: null, p_role: null, p_limit: 25, p_offset: 0 });
    expect(state.client.rpc).toHaveBeenCalledTimes(1);
    expect(page.total).toBe(0);
    expect(page.rows).toEqual([]);
  });
});

describe("getUserDetail walletActivity", () => {
  function detailClient(account: unknown) {
    return supabaseClientMock({
      from: {
        profiles: queryBuilder(ok({ id: USER_ID })),
        user_roles: queryBuilder(ok([])),
        accounts: queryBuilder(ok(account)),
        ledger_entries: queryBuilder(
          ok([
            { id: "e1", transaction_id: "t1", direction: "credit", amount_kobo: 5000, entry_type: "refund", order_id: null, created_at: "2026-01-02T00:00:00Z" },
            { id: "e2", transaction_id: "t2", direction: "debit", amount_kobo: 2000, entry_type: "wallet_spend", order_id: "o2", created_at: "2026-01-01T00:00:00Z" },
          ]),
        ),
        transactions: queryBuilder(
          ok([
            { id: "t1", kind: "refund", order_id: "o1" },
            { id: "t2", kind: "payment_capture", order_id: "o2" },
          ]),
        ),
        orders: queryBuilder(
          ok([
            { id: "o1", code: "KK-1" },
            { id: "o2", code: "KK-2" },
          ]),
        ),
      },
    }) as ReturnType<typeof supabaseClientMock> & { auth: { admin?: unknown } };
  }

  it("resolves transaction and order info for the newest wallet entries", async () => {
    const client = detailClient({ id: "acc1" });
    client.auth.admin = { getUserById: vi.fn(() => Promise.resolve({ data: { user: { email: "a@b.c", banned_until: null } } })) };
    state.client = client;

    const detail = await getUserDetail(USER_ID);

    expect(detail?.walletActivity).toEqual([
      {
        id: "e1",
        createdAt: "2026-01-02T00:00:00Z",
        direction: "credit",
        amountKobo: 5000,
        entryType: "refund",
        transactionKind: "refund",
        orderId: "o1",
        orderCode: "KK-1",
      },
      {
        id: "e2",
        createdAt: "2026-01-01T00:00:00Z",
        direction: "debit",
        amountKobo: 2000,
        entryType: "wallet_spend",
        transactionKind: "payment_capture",
        orderId: "o2",
        orderCode: "KK-2",
      },
    ]);
  });

  it("is empty when the user has no wallet account yet", async () => {
    const client = detailClient(null);
    client.auth.admin = { getUserById: vi.fn(() => Promise.resolve({ data: { user: null } })) };
    state.client = client;

    expect((await getUserDetail(USER_ID))?.walletActivity).toEqual([]);
  });
});

describe("listCustomers", () => {
  it("calls admin_list_customers with the page window and maps order count and wallet balance", async () => {
    state.client = supabaseClientMock({
      rpc: {
        admin_list_customers: ok([
          { id: USER_ID, full_name: "Ada Obi", phone: "0801", status: "active", created_at: "2026-01-01T00:00:00Z", order_count: 3, wallet_balance_kobo: 150000, total_count: 12 },
        ]),
      },
    });

    const page = await listCustomers({ q: " Ada ", status: "active", page: 2, pageSize: 5 });

    expect(state.client.rpc).toHaveBeenCalledWith("admin_list_customers", { p_q: "Ada", p_status: "active", p_limit: 5, p_offset: 5 });
    expect(page).toEqual({
      rows: [{ id: USER_ID, fullName: "Ada Obi", phone: "0801", status: "active", createdAt: "2026-01-01T00:00:00Z", orderCount: 3, walletBalanceKobo: 150000 }],
      total: 12,
      page: 2,
      pageSize: 5,
    });
  });

  it("ignores an unknown status and reports an empty list as total 0", async () => {
    state.client = supabaseClientMock({ rpc: { admin_list_customers: ok([]) } });

    const page = await listCustomers({ status: "bogus" });

    expect(state.client.rpc).toHaveBeenCalledWith("admin_list_customers", { p_q: null, p_status: null, p_limit: 25, p_offset: 0 });
    expect(page.total).toBe(0);
  });
});
