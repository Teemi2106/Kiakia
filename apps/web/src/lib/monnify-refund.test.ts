import { beforeEach, describe, expect, it, vi } from "vitest";

interface Payment {
  id: string;
  provider_ref: string | null;
  amount_kobo: number;
  refund_reference: string | null;
}

const PAYMENT: Payment = { id: "pay-1", provider_ref: "MNFY|1", amount_kobo: 100_000, refund_reference: null };

const state = {
  destination: "gateway" as string | null,
  /** What the ledger says goes back to the card (order_refund_gateway_kobo). */
  ledgerKobo: 100_000 as number | null,
  payment: PAYMENT as Payment | null,
  claimRows: [{ id: "pay-1" }] as { id: string }[],
  claimError: null as { message: string } | null,
  updates: [] as Record<string, unknown>[],
};

function fakeAdminClient() {
  return {
    rpc: vi.fn((fn: string) =>
      Promise.resolve({ data: fn === "order_refund_gateway_kobo" ? state.ledgerKobo : state.destination, error: null }),
    ),
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.payment, error: null }) }) }),
      update: (values: Record<string, unknown>) => {
        state.updates.push(values);
        const chain = {
          eq: () => chain,
          is: () => chain,
          select: () => Promise.resolve({ data: state.claimRows, error: state.claimError }),
          then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
        };
        return chain;
      },
    })),
  };
}

vi.mock("./supabase/admin", () => ({ createAdminClient: () => fakeAdminClient() }));

const initiateRefund = vi.fn();
const getRefundStatus = vi.fn();
vi.mock("./monnify", () => ({
  initiateRefund: (input: unknown) => initiateRefund(input),
  getRefundStatus: (reference: string) => getRefundStatus(reference),
}));

const { requestMonnifyRefundForOrder } = await import("./monnify-refund");

const refundResult = (refundStatus: string) => ({ refundStatus, refundReference: "KK1-refund" });

beforeEach(() => {
  state.destination = "gateway";
  state.ledgerKobo = 100_000;
  state.payment = PAYMENT;
  state.claimRows = [{ id: "pay-1" }];
  state.claimError = null;
  state.updates = [];
  initiateRefund.mockReset();
  getRefundStatus.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("requestMonnifyRefundForOrder", () => {
  it.each(["wallet", null])("never calls Monnify when the ledger refunded the order to %s", async (destination) => {
    state.destination = destination;
    expect(await requestMonnifyRefundForOrder("KK1")).toBe("not_applicable");
    expect(initiateRefund).not.toHaveBeenCalled();
    expect(state.updates).toEqual([]);
  });

  it("asks Monnify for only the card part of a card + wallet order, from the ledger", async () => {
    state.ledgerKobo = 60_000; // the card paid 60_000; the wallet covered the rest
    state.payment = { ...PAYMENT, amount_kobo: 60_000 };
    initiateRefund.mockResolvedValue(refundResult("PENDING"));
    expect(await requestMonnifyRefundForOrder("KK1")).toBe("recorded");
    expect(initiateRefund).toHaveBeenCalledWith(expect.objectContaining({ refundAmountKobo: 60_000 }));
  });

  it("refuses to over-refund: a ledger amount bigger than the card payment asks Monnify for nothing", async () => {
    state.ledgerKobo = 150_000;
    expect(await requestMonnifyRefundForOrder("KK1")).toBe("unknown");
    expect(initiateRefund).not.toHaveBeenCalled();
    expect(state.updates).toEqual([]);
  });

  it("does nothing when the ledger sent no money to the gateway", async () => {
    state.ledgerKobo = 0;
    expect(await requestMonnifyRefundForOrder("KK1")).toBe("not_applicable");
    expect(initiateRefund).not.toHaveBeenCalled();
  });

  it("does nothing for an order with no Monnify payment", async () => {
    state.payment = null;
    expect(await requestMonnifyRefundForOrder("KK1")).toBe("not_applicable");
    state.payment = { ...PAYMENT, provider_ref: null };
    expect(await requestMonnifyRefundForOrder("KK1")).toBe("not_applicable");
    expect(initiateRefund).not.toHaveBeenCalled();
  });

  it("does not ask twice for a refund that was already claimed", async () => {
    state.payment = { ...PAYMENT, refund_reference: "KK1-refund" };
    expect(await requestMonnifyRefundForOrder("KK1")).toBe("already_requested");
    expect(initiateRefund).not.toHaveBeenCalled();
  });

  it("claims the refund before calling Monnify, then records Monnify's status", async () => {
    initiateRefund.mockResolvedValue(refundResult("COMPLETED"));
    expect(await requestMonnifyRefundForOrder("KK1")).toBe("recorded");
    expect(state.updates).toEqual([{ refund_reference: "KK1-refund", refund_status: "pending" }, { refund_status: "completed" }]);
    expect(initiateRefund).toHaveBeenCalledWith(expect.objectContaining({ refundReference: "KK1-refund", refundAmountKobo: 100_000 }));
  });

  it("does not call Monnify when another caller won the claim", async () => {
    state.claimRows = [];
    expect(await requestMonnifyRefundForOrder("KK1")).toBe("already_requested");
    expect(initiateRefund).not.toHaveBeenCalled();
  });

  it("does not call Monnify, and reports unknown, when the claim itself errors", async () => {
    state.claimError = { message: "connection reset" };
    expect(await requestMonnifyRefundForOrder("KK1")).toBe("unknown");
    expect(initiateRefund).not.toHaveBeenCalled();
  });

  it("keeps the claim and reconciles through the refund status lookup when initiation fails", async () => {
    initiateRefund.mockRejectedValue(new Error("timeout"));
    getRefundStatus.mockResolvedValue(refundResult("IN_PROGRESS"));
    expect(await requestMonnifyRefundForOrder("KK1")).toBe("recorded");
    expect(getRefundStatus).toHaveBeenCalledWith("KK1-refund");
    expect(state.updates).toEqual([{ refund_reference: "KK1-refund", refund_status: "pending" }, { refund_status: "pending" }]);
  });

  it("leaves the refund pending and reports unknown when Monnify cannot be reached at all", async () => {
    initiateRefund.mockRejectedValue(new Error("timeout"));
    getRefundStatus.mockRejectedValue(new Error("timeout"));
    expect(await requestMonnifyRefundForOrder("KK1")).toBe("unknown");
    expect(state.updates).toEqual([{ refund_reference: "KK1-refund", refund_status: "pending" }]);
  });
});
