import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, queryBuilder, supabaseClientMock, type QueryResult } from "@/test/supabase-mock";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const VENDOR_ID = "33333333-3333-4333-8333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";

const state = { adminClient: supabaseClientMock() };

const adminSession = { userId: ADMIN_ID, email: null, phone: null };
const requireAdminContext = vi.fn(() => Promise.resolve(adminSession));
vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: () => requireAdminContext() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => state.adminClient) }));

const requestMonnifyRefundForOrder = vi.fn((_code: string): Promise<string> => Promise.resolve("recorded"));
vi.mock("@/lib/monnify-refund", () => ({ requestMonnifyRefundForOrder: (code: string) => requestMonnifyRefundForOrder(code) }));

const {
  approveVendorAction,
  approveRiderDocumentAction,
  rejectVendorAction,
  rejectRiderDocumentAction, refundOrderEscrowAction,
  reassignOrderRiderAction,
  resetDeliveryCodeAttemptsAction,
} = await import("./admin");

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

function useRpc(results: Record<string, QueryResult>) {
  state.adminClient = supabaseClientMock({ rpc: results });
  return state.adminClient.rpc;
}

beforeEach(() => {
  requireAdminContext.mockReset();
  requireAdminContext.mockResolvedValue(adminSession);
  requestMonnifyRefundForOrder.mockReset();
  requestMonnifyRefundForOrder.mockResolvedValue("recorded");
});

describe("authorization ordering", () => {
  it("never reaches the RPC or Monnify when the admin check rejects", async () => {
    const rpc = useRpc({ approve_vendor: ok({}), refund_order_escrow: ok({ code: "KK1" }), admin_reassign_order_rider: ok({}) });
    requireAdminContext.mockRejectedValue(new Error("NEXT_REDIRECT:/home"));

    await expect(approveVendorAction(VENDOR_ID, {})).rejects.toThrow("NEXT_REDIRECT:/home");
    await expect(
      refundOrderEscrowAction({}, formData({ orderId: ORDER_ID, reason: "Customer request", destination: "gateway" })),
    ).rejects.toThrow("NEXT_REDIRECT:/home");
    await expect(reassignOrderRiderAction({}, formData({ orderId: ORDER_ID, reason: "Rider unreachable" }))).rejects.toThrow("NEXT_REDIRECT:/home");

    expect(rpc).not.toHaveBeenCalled();
    expect(state.adminClient.from).not.toHaveBeenCalled();
    expect(requestMonnifyRefundForOrder).not.toHaveBeenCalled();
  });
});

describe("approveVendorAction / rejectVendorAction", () => {
  it("passes the acting admin and the optional reason to the RPC", async () => {
    const rpc = useRpc({ approve_vendor: ok({}), reject_vendor: ok({}) });

    await approveVendorAction(VENDOR_ID, {}, formData({ reason: "  KYC verified  " }));
    await rejectVendorAction(VENDOR_ID, {});

    expect(rpc).toHaveBeenNthCalledWith(1, "approve_vendor", { p_vendor_id: VENDOR_ID, p_actor_id: ADMIN_ID, p_reason: "KYC verified" });
    expect(rpc).toHaveBeenNthCalledWith(2, "reject_vendor", { p_vendor_id: VENDOR_ID, p_actor_id: ADMIN_ID, p_reason: undefined });
  });

  it("revalidates the vendor detail page as well as the list", async () => {
    useRpc({ approve_vendor: ok({}) });
    await approveVendorAction(VENDOR_ID, {});
    expect(revalidatePath).toHaveBeenCalledWith("/admin/vendors");
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/vendors/${VENDOR_ID}`);
  });

  it("rejects a malformed id before the RPC", async () => {
    const rpc = useRpc({ approve_vendor: ok({}) });
    expect(await approveVendorAction("not-a-uuid", {})).toEqual({ error: "Invalid id" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns a user-safe message instead of the raw database error", async () => {
    useRpc({ approve_vendor: fail('relation "vendors" violates foreign key', "23503") });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await approveVendorAction(VENDOR_ID, {})).toEqual({ error: "Something went wrong. Please try again." });
    spy.mockRestore();
  });
});

describe("rider document actions", () => {
  const RIDER_ID = "55555555-5555-4555-8555-555555555555";

  it("revalidates the owning rider's page after approving a document", async () => {
    useRpc({ approve_rider_document: ok({ id: DOCUMENT_ID, rider_id: RIDER_ID }) });
    expect(await approveRiderDocumentAction(DOCUMENT_ID, {})).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/riders/${RIDER_ID}`);
  });

  it("revalidates the owning rider's page after rejecting a document", async () => {
    useRpc({ reject_rider_document: ok({ id: DOCUMENT_ID, rider_id: RIDER_ID }) });
    await rejectRiderDocumentAction({}, formData({ documentId: DOCUMENT_ID, note: "Photo is blurry" }));
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/riders/${RIDER_ID}`);
  });
});

describe("rejectRiderDocumentAction", () => {
  it("requires a note", async () => {
    const rpc = useRpc({ reject_rider_document: ok({}) });
    const result = await rejectRiderDocumentAction({}, formData({ documentId: DOCUMENT_ID, note: " " }));
    expect(result.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the note to the RPC", async () => {
    const rpc = useRpc({ reject_rider_document: ok({}) });
    const result = await rejectRiderDocumentAction({}, formData({ documentId: DOCUMENT_ID, note: "Photo is blurry" }));
    expect(result).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("reject_rider_document", { p_document_id: DOCUMENT_ID, p_actor_id: ADMIN_ID, p_note: "Photo is blurry" });
  });
});

describe("refundOrderEscrowAction", () => {
  const base = { orderId: ORDER_ID, reason: "Vendor never fulfilled" };

  it("requires a reason", async () => {
    const rpc = useRpc({ refund_order_escrow: ok({ code: "KK1" }) });
    const result = await refundOrderEscrowAction({}, formData({ orderId: ORDER_ID, reason: "", destination: "wallet" }));
    expect(result.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an unknown destination", async () => {
    const rpc = useRpc({ refund_order_escrow: ok({ code: "KK1" }) });
    const result = await refundOrderEscrowAction({}, formData({ ...base, destination: "cash" }));
    expect(result.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("defaults to the wallet and does not call Monnify", async () => {
    const rpc = useRpc({ refund_order_escrow: ok({ code: "KK1" }) });
    const result = await refundOrderEscrowAction({}, formData(base));
    expect(result).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("refund_order_escrow", expect.objectContaining({ p_destination: "wallet", p_actor_id: ADMIN_ID }));
    expect(requestMonnifyRefundForOrder).not.toHaveBeenCalled();
  });

  it("asks Monnify for the order code only on a gateway refund", async () => {
    useRpc({ refund_order_escrow: ok({ code: "KK-GW" }) });
    const result = await refundOrderEscrowAction({}, formData({ ...base, destination: "gateway" }));
    expect(result).toEqual({ success: true });
    expect(requestMonnifyRefundForOrder).toHaveBeenCalledTimes(1);
    expect(requestMonnifyRefundForOrder).toHaveBeenCalledWith("KK-GW");
  });

  it("tells the admin to check Monnify when the refund was claimed but its outcome is unknown", async () => {
    useRpc({ refund_order_escrow: ok({ code: "KK-GW" }) });
    requestMonnifyRefundForOrder.mockResolvedValue("unknown");
    const result = await refundOrderEscrowAction({}, formData({ ...base, destination: "gateway" }));
    expect(result).toEqual({ error: "Refund status unknown — check Monnify" });
  });

  it("does not call Monnify when the ledger already refunded the order to the other destination", async () => {
    useRpc({
      refund_order_escrow: fail("refund_order_escrow: order KK1 was already refunded to the wallet, not the gateway - refusing to refund it twice", "23514"),
    });
    const result = await refundOrderEscrowAction({}, formData({ ...base, destination: "gateway" }));
    expect(result.error).toBe("order KK1 was already refunded to the wallet, not the gateway - refusing to refund it twice");
    expect(requestMonnifyRefundForOrder).not.toHaveBeenCalled();
  });

  it("does not call Monnify when the ledger refund fails, and shows the admin-facing message", async () => {
    useRpc({
      refund_order_escrow: fail("refund_order_escrow: order 1 escrow has already been released to vendor/rider/platform", "23514"),
    });
    const result = await refundOrderEscrowAction({}, formData({ ...base, destination: "gateway" }));
    expect(result.error).toBe("order 1 escrow has already been released to vendor/rider/platform");
    expect(requestMonnifyRefundForOrder).not.toHaveBeenCalled();
  });

  it("maps a missing order and a permission failure to fixed wording", async () => {
    useRpc({ refund_order_escrow: fail("refund_order_escrow: order does not exist", "P0002") });
    expect((await refundOrderEscrowAction({}, formData(base))).error).toBe("That record no longer exists.");

    useRpc({ refund_order_escrow: fail("is not an admin", "42501") });
    expect((await refundOrderEscrowAction({}, formData(base))).error).toBe("You don't have permission to do that.");
  });
});

describe("resetDeliveryCodeAttemptsAction", () => {
  it("calls the RPC with the actor and optional reason", async () => {
    const rpc = useRpc({ admin_reset_delivery_code_attempts: ok({}) });
    await resetDeliveryCodeAttemptsAction(ORDER_ID, {}, formData({ reason: "Customer verified by phone" }));
    expect(rpc).toHaveBeenCalledWith("admin_reset_delivery_code_attempts", {
      p_order_id: ORDER_ID,
      p_actor_id: ADMIN_ID,
      p_reason: "Customer verified by phone",
    });
  });
});

describe("reassignOrderRiderAction", () => {
  const OLD_RIDER = "66666666-6666-4666-8666-666666666666";
  const NEW_RIDER = "77777777-7777-4777-8777-777777777777";
  const base = { orderId: ORDER_ID, reason: "Rider unreachable" };

  function useReassign(result: QueryResult, previousRider: string | null = OLD_RIDER) {
    state.adminClient = supabaseClientMock({
      rpc: { admin_reassign_order_rider: result },
      from: { orders: queryBuilder(ok({ rider_id: previousRider })) },
    });
    return state.adminClient.rpc;
  }

  it("treats an empty rider as unassign-and-re-offer", async () => {
    const rpc = useReassign(ok({ rider_id: null }));
    expect(await reassignOrderRiderAction({}, formData({ ...base, riderId: "" }))).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("admin_reassign_order_rider", {
      p_order_id: ORDER_ID,
      p_rider_id: null,
      p_reason: "Rider unreachable",
      p_actor_id: ADMIN_ID,
    });
  });

  it("sends a chosen rider to the RPC", async () => {
    const rpc = useReassign(ok({ rider_id: NEW_RIDER }));
    await reassignOrderRiderAction({}, formData({ ...base, riderId: NEW_RIDER }));
    expect(rpc).toHaveBeenCalledWith("admin_reassign_order_rider", expect.objectContaining({ p_rider_id: NEW_RIDER, p_actor_id: ADMIN_ID }));
  });

  it("requires a well-formed order and rider before the RPC", async () => {
    const rpc = useReassign(ok({}));
    expect(await reassignOrderRiderAction({}, formData({ ...base, orderId: "nope" }))).toEqual({ error: "Invalid id" });
    expect(await reassignOrderRiderAction({}, formData({ ...base, riderId: "nope" }))).toEqual({ error: "Invalid id" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("revalidates the order and both the removed and the new rider", async () => {
    useReassign(ok({ rider_id: NEW_RIDER }));
    await reassignOrderRiderAction({}, formData({ ...base, riderId: NEW_RIDER }));
    expect(revalidatePath).toHaveBeenCalledWith("/admin/orders");
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/orders/${ORDER_ID}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/riders/${OLD_RIDER}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/riders/${NEW_RIDER}`);
  });

  it("revalidates no rider page for an order that had and gets none", async () => {
    vi.mocked(revalidatePath).mockClear();
    useReassign(ok({ rider_id: null }), null);
    await reassignOrderRiderAction({}, formData(base));
    expect(vi.mocked(revalidatePath).mock.calls.map(([path]) => path)).toEqual(["/admin/orders", `/admin/orders/${ORDER_ID}`]);
  });

  it("shows the admin-facing refusal and maps the other failures", async () => {
    useReassign(fail("admin_reassign_order_rider: this rider is offline", "23514"));
    expect(await reassignOrderRiderAction({}, formData({ ...base, riderId: NEW_RIDER }))).toEqual({ error: "this rider is offline" });

    useReassign(fail("admin_reassign_order_rider: order does not exist", "P0002"));
    expect((await reassignOrderRiderAction({}, formData(base))).error).toBe("That record no longer exists.");

    useReassign(fail("actor is not an active account", "42501"));
    expect((await reassignOrderRiderAction({}, formData(base))).error).toBe("You don't have permission to do that.");
  });

  it("does not revalidate when the RPC fails", async () => {
    vi.mocked(revalidatePath).mockClear();
    useReassign(fail("admin_reassign_order_rider: this rider is offline", "23514"));
    await reassignOrderRiderAction({}, formData({ ...base, riderId: NEW_RIDER }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
