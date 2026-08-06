import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

const state = {
  session: { current: { userId: "customer-a", email: "customer-a@example.com", phone: null } as unknown },
  client: { current: supabaseClientMock() },
  adminClient: { current: supabaseClientMock() },
};

const requireRole = vi.fn((..._args: unknown[]) => Promise.resolve(state.session.current));
const verifySession = vi.fn(() => Promise.resolve(state.session.current));

vi.mock("@/lib/auth/dal", () => ({
  requireRole: (...args: unknown[]) => requireRole(...args),
  verifySession: () => verifySession(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(() => Promise.resolve(state.client.current)) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => state.adminClient.current) }));

const initializeTransaction = vi.fn();
vi.mock("@/lib/monnify", () => ({ initializeTransaction: (...args: unknown[]) => initializeTransaction(...args) }));

const { advanceOrderAction, placeOrderAction, retryPaymentAction } = await import("./orders");

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const VALID_NEW_ADDRESS = { line1: "1 Test Street", lat: "9.05", lng: "7.45" };
const OPEN_CART = { data: { id: "cart-1" }, error: null };
const PLACED_ORDER = {
  data: { id: "order-1", code: "KK-0001", total_kobo: 500000 },
  error: null,
};

describe("placeOrderAction", () => {
  beforeEach(() => {
    requireRole.mockClear();
    verifySession.mockClear();
    initializeTransaction.mockReset();
    state.session.current = { userId: "customer-a", email: "customer-a@example.com", phone: null };
    state.client.current = supabaseClientMock({
      from: {
        carts: queryBuilder(OPEN_CART),
        profiles: queryBuilder(ok({ full_name: "Ada Lovelace" })),
      },
      rpc: { place_order: PLACED_ORDER },
    });
    state.adminClient.current = supabaseClientMock({ from: { payments: queryBuilder(ok(null)) } });
  });

  it("rejects checkout with neither a saved address nor a new one, without touching the cart/RPC", async () => {
    const result = await placeOrderAction({}, formData({}));
    expect(result.error).toBeTruthy();
    expect(state.client.current.rpc).not.toHaveBeenCalled();
    expect(state.client.current.from).not.toHaveBeenCalledWith("carts");
  });

  it("treats a saved address that doesn't belong to this customer as not found (ownership check happens in the query itself)", async () => {
    state.client.current = supabaseClientMock({
      from: {
        addresses: queryBuilder(ok(null)), // .eq("customer_id", session.userId) excluded it
        carts: queryBuilder(OPEN_CART),
      },
      rpc: { place_order: PLACED_ORDER },
    });
    const result = await placeOrderAction({}, formData({ addressId: "someone-elses-address" }));
    expect(result.error).toContain("could not be found");
    expect(state.client.current.rpc).not.toHaveBeenCalled();
  });

  it("rejects checkout when the customer has no open cart", async () => {
    state.client.current = supabaseClientMock({
      from: { carts: queryBuilder(ok(null)) },
      rpc: { place_order: PLACED_ORDER },
    });
    const result = await placeOrderAction({}, formData(VALID_NEW_ADDRESS));
    expect(result.error).toBe("Your cart is empty.");
    expect(state.client.current.rpc).not.toHaveBeenCalled();
  });

  it("surfaces a friendly message when the address is outside every service area", async () => {
    state.client.current = supabaseClientMock({
      from: { carts: queryBuilder(OPEN_CART) },
      rpc: { place_order: { data: null, error: { message: "address is outside every active service area" } } },
    });
    const result = await placeOrderAction({}, formData(VALID_NEW_ADDRESS));
    expect(result.error).toContain("outside our delivery area");
  });

  it("never leaks the raw place_order() SQL error for unrelated failures", async () => {
    state.client.current = supabaseClientMock({
      from: { carts: queryBuilder(OPEN_CART) },
      rpc: { place_order: { data: null, error: { message: 'duplicate key value violates unique constraint "orders_pkey"' } } },
    });
    const result = await placeOrderAction({}, formData(VALID_NEW_ADDRESS));
    expect(result.error).not.toContain("constraint");
    expect(result.error).not.toContain("orders_pkey");
  });

  it("on success, initializes a Monnify transaction, records a pending payment keyed by the order code, and redirects to the checkout URL", async () => {
    initializeTransaction.mockResolvedValue({
      checkoutUrl: "https://sandbox.monnify.com/checkout/abc",
      transactionReference: "mnfy-txn-1",
      paymentReference: "KK-0001",
    });
    const paymentsInsert = vi.fn(() => queryBuilder(ok(null)));
    state.adminClient.current = supabaseClientMock({ from: { payments: { insert: paymentsInsert } as never } });

    await expect(placeOrderAction({}, formData(VALID_NEW_ADDRESS))).rejects.toThrow(
      "NEXT_REDIRECT:https://sandbox.monnify.com/checkout/abc",
    );

    expect(paymentsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: "order-1", idempotency_key: "KK-0001", status: "pending" }),
    );
  });

  it("leaves the order in draft and redirects to its detail page (not a dead end) if Monnify init fails", async () => {
    initializeTransaction.mockRejectedValue(new Error("Monnify auth failed: 401"));
    await expect(placeOrderAction({}, formData(VALID_NEW_ADDRESS))).rejects.toThrow("NEXT_REDIRECT:/orders/order-1");
  });
});

describe("retryPaymentAction", () => {
  beforeEach(() => {
    initializeTransaction.mockReset();
    state.session.current = { userId: "customer-a", email: "customer-a@example.com", phone: null };
  });

  it("refuses to retry payment on an order belonging to a different customer", async () => {
    state.client.current = supabaseClientMock({
      from: {
        orders: queryBuilder(
          ok({ id: "order-1", code: "KK-1", total_kobo: 1000, customer_id: "someone-else", status: "draft", payment_status: "pending" }),
        ),
      },
    });
    await expect(retryPaymentAction("order-1")).rejects.toThrow("Order not found.");
    expect(initializeTransaction).not.toHaveBeenCalled();
  });

  it("refuses to retry payment on an order that's already been paid", async () => {
    state.client.current = supabaseClientMock({
      from: {
        orders: queryBuilder(
          ok({ id: "order-1", code: "KK-1", total_kobo: 1000, customer_id: "customer-a", status: "placed", payment_status: "paid" }),
        ),
      },
    });
    await expect(retryPaymentAction("order-1")).rejects.toThrow("already been paid for.");
    expect(initializeTransaction).not.toHaveBeenCalled();
  });

  it("redirects to a fresh checkout URL for a legitimate unpaid draft order", async () => {
    state.client.current = supabaseClientMock({
      from: {
        orders: queryBuilder(
          ok({ id: "order-1", code: "KK-1", total_kobo: 1000, customer_id: "customer-a", status: "draft", payment_status: "pending" }),
        ),
        profiles: queryBuilder(ok({ full_name: "Ada" })),
      },
    });
    initializeTransaction.mockResolvedValue({
      checkoutUrl: "https://sandbox.monnify.com/checkout/retry",
      transactionReference: "ref",
      paymentReference: "KK-1",
    });
    await expect(retryPaymentAction("order-1")).rejects.toThrow("NEXT_REDIRECT:https://sandbox.monnify.com/checkout/retry");
  });
});

describe("advanceOrderAction", () => {
  beforeEach(() => {
    requireRole.mockClear();
    requireRole.mockImplementation(() => Promise.resolve({ userId: "vendor-staff-1", email: null, phone: null }));
  });

  it("requires a vendor-staff role before touching the RPC (unauthorized callers never reach transition_order)", async () => {
    requireRole.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT:/");
    });
    state.client.current = supabaseClientMock({ rpc: { transition_order: ok(null) } });
    await expect(advanceOrderAction("order-1", "accepted")).rejects.toThrow("NEXT_REDIRECT:/");
    expect(state.client.current.rpc).not.toHaveBeenCalled();
  });

  it("surfaces an illegal state-machine transition as a thrown error", async () => {
    state.client.current = supabaseClientMock({
      rpc: { transition_order: { data: null, error: { message: "illegal transition: delivered -> placed" } } },
    });
    await expect(advanceOrderAction("order-1", "placed")).rejects.toThrow("illegal transition");
  });

  it("passes actor_type: 'vendor' and the caller's own id — a vendor can never claim to act as someone else", async () => {
    state.client.current = supabaseClientMock({ rpc: { transition_order: ok(null) } });
    await advanceOrderAction("order-1", "accepted");
    expect(state.client.current.rpc).toHaveBeenCalledWith(
      "transition_order",
      expect.objectContaining({ p_actor_type: "vendor", p_actor_id: "vendor-staff-1" }),
    );
  });
});
