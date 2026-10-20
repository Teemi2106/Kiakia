import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseClientMock, type QueryResult } from "@/test/supabase-mock";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const VENDOR_ID = "33333333-3333-4333-8333-333333333333";
const AREA_ID = "66666666-6666-4666-8666-666666666666";

const state = { adminClient: supabaseClientMock() };

const adminSession = { userId: ADMIN_ID, email: null, phone: null };
const requireAdminContext = vi.fn(() => Promise.resolve(adminSession));
const requireFinanceContext = vi.fn(() => Promise.resolve(adminSession));
vi.mock("@/lib/auth/dal", () => ({
  requireAdminContext: () => requireAdminContext(),
  requireFinanceContext: () => requireFinanceContext(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => state.adminClient) }));

const requestMonnifyRefundForOrder = vi.fn((_code: string): Promise<string> => Promise.resolve("recorded"));
vi.mock("@/lib/monnify-refund", () => ({ requestMonnifyRefundForOrder: (code: string) => requestMonnifyRefundForOrder(code) }));

const { recordPayoutAction, requestGatewayRefundAction } = await import("./admin-finance");
const { setVendorCommissionAction, updateServiceAreaAction } = await import("./admin-settings");

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

function useClient(rpc: Record<string, QueryResult>) {
  state.adminClient = supabaseClientMock({ rpc });
  return state.adminClient.rpc;
}

beforeEach(() => {
  requireAdminContext.mockReset();
  requireAdminContext.mockResolvedValue(adminSession);
  requireFinanceContext.mockReset();
  requireFinanceContext.mockResolvedValue(adminSession);
  requestMonnifyRefundForOrder.mockReset();
  requestMonnifyRefundForOrder.mockResolvedValue("recorded");
});

describe("recordPayoutAction", () => {
  const base = { ownerType: "vendor", ownerId: VENDOR_ID, amountNaira: "1,234.50", externalReference: "BANK-REF_001", reason: "Weekly payout" };

  it("converts naira to integer kobo exactly once", async () => {
    const rpc = useClient({ admin_record_payout: ok({}) });
    expect(await recordPayoutAction({}, formData(base))).toEqual({ success: true, message: "Recorded. ₦1,234.50 is now marked as paid." });
    expect(rpc).toHaveBeenCalledWith("admin_record_payout", {
      p_owner_type: "vendor",
      p_owner_id: VENDOR_ID,
      p_amount_kobo: 123_450,
      p_external_reference: "BANK-REF_001",
      p_reason: "Weekly payout",
      p_actor_id: ADMIN_ID,
    });
  });

  it("avoids float drift (1.15 naira is 115 kobo)", async () => {
    const rpc = useClient({ admin_record_payout: ok({}) });
    await recordPayoutAction({}, formData({ ...base, amountNaira: "1.15" }));
    expect(rpc).toHaveBeenCalledWith("admin_record_payout", expect.objectContaining({ p_amount_kobo: 115 }));
  });

  it.each(["0", "0.00", "-5", "abc", "1.234", "1e3", ""])("rejects amount %j before the RPC", async (amountNaira) => {
    const rpc = useClient({ admin_record_payout: ok({}) });
    const result = await recordPayoutAction({}, formData({ ...base, amountNaira }));
    expect(result.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed bank reference and a non-uuid owner", async () => {
    const rpc = useClient({ admin_record_payout: ok({}) });
    expect((await recordPayoutAction({}, formData({ ...base, externalReference: "a b" }))).error).toBeTruthy();
    expect((await recordPayoutAction({}, formData({ ...base, ownerId: "x" }))).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never reaches the RPC when the finance check rejects", async () => {
    const rpc = useClient({ admin_record_payout: ok({}) });
    requireFinanceContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/admin"));
    await expect(recordPayoutAction({}, formData(base))).rejects.toThrow("NEXT_REDIRECT:/admin");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says an overdraw in naira, never kobo, and tells the admin what to do", async () => {
    useClient({ admin_record_payout: fail("admin_record_payout: vendor available balance is 60000 kobo, cannot pay out 60001 kobo", "23514") });
    const { error } = await recordPayoutAction({}, formData(base));
    expect(error).toBe("Only ₦600.00 is owed to this vendor now, so ₦600.01 is too much. Refresh the page and check the amount.");
    expect(error).not.toMatch(/kobo/i);
  });

  it("explains a reused bank reference in plain words", async () => {
    useClient({ admin_record_payout: fail("admin_record_payout: reference BANK-REF_001 was already used for a different payout", "23505") });
    const { error } = await recordPayoutAction({}, formData(base));
    expect(error).toContain("already been used for a different payment");
    expect(error).toContain("payment history");
  });

  it("is safe to submit twice: the RPC returns the same payout for a repeated reference, and both calls succeed", async () => {
    const rpc = useClient({ admin_record_payout: ok({ id: "tx-1" }) });
    expect((await recordPayoutAction({}, formData(base))).success).toBe(true);
    expect((await recordPayoutAction({}, formData(base))).success).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  });
});

describe("requestGatewayRefundAction", () => {
  it("calls Monnify with the code the RPC returned and reports success once its status is recorded", async () => {
    useClient({ admin_request_gateway_refund: ok("KK-GW") });
    expect(await requestGatewayRefundAction({}, formData({ orderId: ORDER_ID }))).toEqual({ success: true });
    expect(requestMonnifyRefundForOrder).toHaveBeenCalledWith("KK-GW");
  });

  it("tells the admin to check Monnify when the outcome is unknown", async () => {
    useClient({ admin_request_gateway_refund: ok("KK-GW") });
    requestMonnifyRefundForOrder.mockResolvedValue("unknown");
    const result = await requestGatewayRefundAction({}, formData({ orderId: ORDER_ID }));
    expect(result).toEqual({ error: "Refund status unknown — check Monnify" });
  });

  it.each(["already_requested", "not_applicable"])("reports that nothing was sent when the outcome is %s", async (outcome) => {
    useClient({ admin_request_gateway_refund: ok("KK-GW") });
    requestMonnifyRefundForOrder.mockResolvedValue(outcome);
    const result = await requestGatewayRefundAction({}, formData({ orderId: ORDER_ID }));
    expect(result.error).toContain("No refund request was sent");
  });

  it("does not call Monnify when the RPC refuses", async () => {
    useClient({ admin_request_gateway_refund: fail("admin_request_gateway_refund: a gateway refund was already requested", "23514") });
    const result = await requestGatewayRefundAction({}, formData({ orderId: ORDER_ID }));
    expect(result.error).toBe("a gateway refund was already requested");
    expect(requestMonnifyRefundForOrder).not.toHaveBeenCalled();
  });

  it("never reaches the RPC when the admin check rejects", async () => {
    const rpc = useClient({ admin_request_gateway_refund: ok("KK-GW") });
    requireAdminContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/home"));
    await expect(requestGatewayRefundAction({}, formData({ orderId: ORDER_ID }))).rejects.toThrow("NEXT_REDIRECT:/home");
    expect(rpc).not.toHaveBeenCalled();
    expect(requestMonnifyRefundForOrder).not.toHaveBeenCalled();
  });
});

describe("setVendorCommissionAction", () => {
  it("never reaches the RPC when the finance check rejects", async () => {
    const rpc = useClient({ admin_set_vendor_commission: ok({}) });
    requireFinanceContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/admin"));
    await expect(
      setVendorCommissionAction({}, formData({ vendorId: VENDOR_ID, commissionPercent: "10", reason: "Negotiated rate" })),
    ).rejects.toThrow("NEXT_REDIRECT:/admin");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("converts a percentage to basis points", async () => {
    const rpc = useClient({ admin_set_vendor_commission: ok({}) });
    await setVendorCommissionAction({}, formData({ vendorId: VENDOR_ID, commissionPercent: "12.5", reason: "Negotiated rate" }));
    expect(rpc).toHaveBeenCalledWith("admin_set_vendor_commission", {
      p_vendor_id: VENDOR_ID,
      p_commission_bps: 1250,
      p_reason: "Negotiated rate",
      p_actor_id: ADMIN_ID,
    });
  });

  it.each(["101", "-1", "abc", "12.345"])("rejects %j", async (commissionPercent) => {
    const rpc = useClient({ admin_set_vendor_commission: ok({}) });
    const result = await setVendorCommissionAction({}, formData({ vendorId: VENDOR_ID, commissionPercent, reason: "Negotiated rate" }));
    expect(result.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("updateServiceAreaAction", () => {
  it("never reaches the RPC when the finance check rejects", async () => {
    const rpc = useClient({ admin_update_service_area: ok({}) });
    requireFinanceContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/admin"));
    await expect(updateServiceAreaAction({}, formData(base))).rejects.toThrow("NEXT_REDIRECT:/admin");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a fee above NGN 100,000 before the RPC", async () => {
    const rpc = useClient({ admin_update_service_area: ok({}) });
    const result = await updateServiceAreaAction({}, formData({ ...base, baseDeliveryFeeNaira: "100000.01" }));
    expect(result.error).toBe("Base delivery fee cannot exceed NGN 100,000");
    expect(rpc).not.toHaveBeenCalled();
    expect((await updateServiceAreaAction({}, formData({ ...base, baseDeliveryFeeNaira: "100000" }))).success).toBe(true);
  });

  const base = {
    serviceAreaId: AREA_ID,
    baseDeliveryFeeNaira: "500",
    perKmFeeNaira: "100.50",
    riderBaseFeeNaira: "300",
    riderPerKmFeeNaira: "0",
    isActive: "true",
    reason: "Fuel price change",
  };

  it("converts every fee to kobo", async () => {
    const rpc = useClient({ admin_update_service_area: ok({}) });
    expect(await updateServiceAreaAction({}, formData(base))).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("admin_update_service_area", {
      p_service_area_id: AREA_ID,
      p_base_delivery_fee_kobo: 50_000,
      p_per_km_fee_kobo: 10_050,
      p_rider_base_fee_kobo: 30_000,
      p_rider_per_km_fee_kobo: 0,
      p_is_active: true,
      p_reason: "Fuel price change",
      p_actor_id: ADMIN_ID,
    });
  });

  it("requires an explicit active flag so an absent field cannot deactivate the area", async () => {
    const rpc = useClient({ admin_update_service_area: ok({}) });
    const { isActive: _omitted, ...withoutActive } = base;
    expect((await updateServiceAreaAction({}, formData(withoutActive))).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
});
