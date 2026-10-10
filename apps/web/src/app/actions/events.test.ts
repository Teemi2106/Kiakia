import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseClientMock } from "@/test/supabase-mock";

const VENDOR_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";

const state = {
  session: { current: { userId: "customer-a", email: "a@example.com", phone: null } as unknown },
  client: { current: supabaseClientMock() },
};

const getOptionalSession = vi.fn(() => Promise.resolve(state.session.current));
vi.mock("@/lib/auth/dal", () => ({
  getOptionalSession: () => getOptionalSession(),
}));

const createClient = vi.fn(() => Promise.resolve(state.client.current));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const { logCustomerEventAction } = await import("./events");

function withRpc(result: ReturnType<typeof ok> | ReturnType<typeof fail>) {
  const client = supabaseClientMock({ rpc: { log_customer_event: result } });
  state.client.current = client;
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session.current = { userId: "customer-a", email: "a@example.com", phone: null };
  withRpc(ok(null));
});

describe("logCustomerEventAction", () => {
  it("calls the RPC with exactly the named params and returns ok", async () => {
    const client = withRpc(ok(null));
    const result = await logCustomerEventAction({ eventType: "view_item", menuItemId: ITEM_ID, vendorId: VENDOR_ID });

    expect(result).toEqual({ ok: true });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("log_customer_event", {
      p_event_type: "view_item",
      p_vendor_id: VENDOR_ID,
      p_menu_item_id: ITEM_ID,
      p_search_query: null,
    });
  });

  it("sends a trimmed search query and nulls the absent ids", async () => {
    const client = withRpc(ok(null));
    await logCustomerEventAction({ eventType: "search", searchQuery: "  jollof rice " });
    expect(client.rpc).toHaveBeenCalledWith("log_customer_event", {
      p_event_type: "search",
      p_vendor_id: null,
      p_menu_item_id: null,
      p_search_query: "jollof rice",
    });
  });

  it("never passes a customer id to the RPC, even if the caller smuggles one in", async () => {
    const client = withRpc(ok(null));
    const smuggled = {
      eventType: "view_vendor",
      vendorId: VENDOR_ID,
      customerId: "someone-else",
      customer_id: "someone-else",
    } as unknown as Parameters<typeof logCustomerEventAction>[0];

    // .strict() rejects the unknown keys outright - nothing is forwarded.
    expect(await logCustomerEventAction(smuggled)).toEqual({ ok: false });
    expect(client.rpc).not.toHaveBeenCalled();

    await logCustomerEventAction({ eventType: "view_vendor", vendorId: VENDOR_ID });
    const params = client.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(params).sort()).toEqual(["p_event_type", "p_menu_item_id", "p_search_query", "p_vendor_id"]);
  });

  it("rejects cart event types (trigger-only) without touching the RPC", async () => {
    const client = withRpc(ok(null));
    for (const eventType of ["cart_add", "cart_remove", "nonsense"]) {
      const result = await logCustomerEventAction({ eventType, menuItemId: ITEM_ID } as never);
      expect(result).toEqual({ ok: false });
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed uuids, over-long queries and missing required fields", async () => {
    const client = withRpc(ok(null));
    const bad = [
      { eventType: "view_vendor", vendorId: "not-a-uuid" },
      { eventType: "view_item", menuItemId: "123" },
      { eventType: "search", searchQuery: "x".repeat(81) },
      { eventType: "search" },
      { eventType: "search", searchQuery: "   " },
      { eventType: "view_vendor" },
      { eventType: "view_item" },
      { eventType: "recommendation_click" },
      null,
      undefined,
      "view_item",
    ];
    for (const input of bad) {
      expect(await logCustomerEventAction(input as never)).toEqual({ ok: false });
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("accepts a search query of exactly 80 characters", async () => {
    const client = withRpc(ok(null));
    expect(await logCustomerEventAction({ eventType: "search", searchQuery: "x".repeat(80) })).toEqual({ ok: true });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("no-ops for a logged-out caller (no redirect, no RPC)", async () => {
    state.session.current = null;
    const client = withRpc(ok(null));
    const result = await logCustomerEventAction({ eventType: "view_vendor", vendorId: VENDOR_ID });
    expect(result).toEqual({ ok: false });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("swallows an RPC error and resolves { ok: false }", async () => {
    withRpc(fail("rate limited", "P0001"));
    await expect(logCustomerEventAction({ eventType: "view_vendor", vendorId: VENDOR_ID })).resolves.toEqual({
      ok: false,
    });
  });

  it("swallows a thrown exception (e.g. the client throwing) and never rejects", async () => {
    createClient.mockRejectedValueOnce(new Error("cookies() outside request scope"));
    await expect(logCustomerEventAction({ eventType: "view_vendor", vendorId: VENDOR_ID })).resolves.toEqual({
      ok: false,
    });
  });
});
