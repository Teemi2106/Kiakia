import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseClientMock, type QueryResult } from "@/test/supabase-mock";

const VENDOR_USER = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";

const state = { client: supabaseClientMock() };
const requireVendorContext = vi.fn(() => Promise.resolve({ userId: VENDOR_USER, email: null, phone: null }));
vi.mock("@/lib/auth/dal", () => ({ requireVendorContext: () => requireVendorContext() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(() => Promise.resolve(state.client)) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("the vendor actions must use the vendor's own session, never the service role");
  },
}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { advanceSelfDeliveryAction, completeSelfDeliveryAction, expandRiderSearchAction, startSelfDeliveryAction, updatePrepEstimateAction } = await import("./vendor-delivery");

function useClient(rpc: Record<string, QueryResult>) {
  state.client = supabaseClientMock({ rpc });
  return state.client.rpc;
}

beforeEach(() => {
  requireVendorContext.mockReset();
  requireVendorContext.mockResolvedValue({ userId: VENDOR_USER, email: null, phone: null });
  revalidatePath.mockReset();
});

describe("vendor gate", () => {
  it("every action re-checks the vendor context and never calls an RPC when it refuses", async () => {
    const rpc = useClient({});
    for (const call of [
      () => expandRiderSearchAction(ORDER_ID),
      () => startSelfDeliveryAction(ORDER_ID),
      () => advanceSelfDeliveryAction(ORDER_ID, "picked_up"),
      () => completeSelfDeliveryAction(ORDER_ID, "1234"),
      () => updatePrepEstimateAction(ORDER_ID, 15),
    ]) {
      requireVendorContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
      await expect(call()).rejects.toThrow("NEXT_REDIRECT");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed order id before the RPC", async () => {
    const rpc = useClient({});
    expect((await expandRiderSearchAction("nope")).ok).toBe(false);
    expect((await startSelfDeliveryAction("nope")).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("expandRiderSearchAction", () => {
  it("reports how many riders were sent the order, on the vendor's own client", async () => {
    const rpc = useClient({ vendor_expand_rider_search: ok({ offers_created: 3, riders_in_range: null }) });
    const result = await expandRiderSearchAction(ORDER_ID);
    expect(result).toEqual({ ok: true, message: "Sent to 3 riders." });
    expect(rpc).toHaveBeenCalledWith("vendor_expand_rider_search", { p_order_id: ORDER_ID });
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/orders/${ORDER_ID}`);
  });

  it("says there are still no riders", async () => {
    useClient({ vendor_expand_rider_search: ok({ offers_created: 0, riders_in_range: 0 }) });
    expect((await expandRiderSearchAction(ORDER_ID)).message).toBe("Still no riders; you can deliver it yourself.");
  });

  it("returns the countdown when the database rate-limits it (P0429)", async () => {
    useClient({ vendor_expand_rider_search: fail("rate_limited: try again in 40 seconds", "P0429") });
    expect(await expandRiderSearchAction(ORDER_ID)).toEqual({ ok: false, error: "Please wait 40 seconds before searching again.", retryInSeconds: 40 });
  });

  it("explains the 3-times limit without a countdown", async () => {
    useClient({ vendor_expand_rider_search: fail("rate_limited: the rider search for this order can only be widened 3 times", "P0429") });
    expect(await expandRiderSearchAction(ORDER_ID)).toEqual({ ok: false, error: "the rider search for this order can only be widened 3 times" });
  });

  it("hides unknown database errors", async () => {
    useClient({ vendor_expand_rider_search: fail('relation "orders" does not exist', "42P01") });
    expect((await expandRiderSearchAction(ORDER_ID)).error).toBe("Something went wrong. Please try again.");
  });
});

describe("updatePrepEstimateAction", () => {
  const result = { order_id: ORDER_ID, expected_ready_at: "2026-10-25T15:30:00Z", start_at: "2026-10-25T15:12:00Z", rider_notified: true };

  it("sends the minutes on the vendor's own client and reports the new ready time", async () => {
    const rpc = useClient({ vendor_update_prep_estimate: ok(result) });
    expect(await updatePrepEstimateAction(ORDER_ID, 25)).toEqual({ ok: true, message: "Got it. Food expected ready at 16:30. Your rider has been told." });
    expect(rpc).toHaveBeenCalledWith("vendor_update_prep_estimate", { p_order_id: ORDER_ID, p_ready_in_minutes: 25 });
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/orders/${ORDER_ID}`);
  });

  it("refuses a bad order id or minutes outside 1-180 before the database", async () => {
    const rpc = useClient({ vendor_update_prep_estimate: ok(result) });
    expect((await updatePrepEstimateAction("nope", 10)).ok).toBe(false);
    for (const minutes of [0, -1, 181, 2.5, Number.NaN]) expect((await updatePrepEstimateAction(ORDER_ID, minutes)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the database's refusals (rate limit, range, permission) to friendly wording", async () => {
    useClient({ vendor_update_prep_estimate: fail("vendor_update_prep_estimate: too many changes for this order", "P0429") });
    expect((await updatePrepEstimateAction(ORDER_ID, 10)).error).toMatch(/several times/);
    useClient({ vendor_update_prep_estimate: fail("vendor_update_prep_estimate: ready_in_minutes must be between 1 and 180", "23514") });
    expect((await updatePrepEstimateAction(ORDER_ID, 10)).error).toBe("Enter a time between 1 and 180 minutes.");
    useClient({ vendor_update_prep_estimate: fail("not your order", "42501") });
    expect((await updatePrepEstimateAction(ORDER_ID, 10)).error).toBe("You don't have permission to do that for this order.");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("self-delivery steps", () => {
  it("starts self delivery", async () => {
    const rpc = useClient({ vendor_start_self_delivery: ok({}) });
    expect((await startSelfDeliveryAction(ORDER_ID)).ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("vendor_start_self_delivery", { p_order_id: ORDER_ID });
  });

  it("advances only to the allowed steps", async () => {
    const rpc = useClient({ vendor_advance_self_delivery: ok({}) });
    expect((await advanceSelfDeliveryAction(ORDER_ID, "in_transit")).ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("vendor_advance_self_delivery", { p_order_id: ORDER_ID, p_to_status: "in_transit" });
    expect((await advanceSelfDeliveryAction(ORDER_ID, "delivered" as never)).ok).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("shows the database's refusal in plain words", async () => {
    useClient({ vendor_advance_self_delivery: fail("vendor_advance_self_delivery: this order is not being delivered by you", "23514") });
    expect((await advanceSelfDeliveryAction(ORDER_ID, "picked_up")).error).toBe("this order is not being delivered by you");
  });
});

describe("completeSelfDeliveryAction", () => {
  it("completes with the right code", async () => {
    const rpc = useClient({ vendor_complete_self_delivery: ok({ code_matched: true, status: "delivered", delivery_by: "vendor" }) });
    expect(await completeSelfDeliveryAction(ORDER_ID, "1234")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("vendor_complete_self_delivery", { p_order_id: ORDER_ID, p_code: "1234" });
  });

  it("refuses a code that is not 4 digits without calling the database", async () => {
    const rpc = useClient({ vendor_complete_self_delivery: ok({}) });
    for (const code of ["", "12", "12345", "abcd"]) expect((await completeSelfDeliveryAction(ORDER_ID, code)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a wrong code in plain words", async () => {
    useClient({ vendor_complete_self_delivery: ok({ code_matched: false, status: "arrived", delivery_by: "vendor" }) });
    const result = await completeSelfDeliveryAction(ORDER_ID, "0000");
    expect(result.ok).toBe(false);
    expect(result.locked).toBe(false);
    expect(result.error).toContain("That code is not right");
  });

  it("locks and points to KiaKia support after too many wrong codes", async () => {
    useClient({ vendor_complete_self_delivery: fail("verify_delivery_and_release_escrow: too many incorrect delivery-code attempts for order x", "23514") });
    const result = await completeSelfDeliveryAction(ORDER_ID, "0000");
    expect(result.locked).toBe(true);
    expect(result.error).toMatch(/contact KiaKia support/);
  });
});
