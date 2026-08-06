import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

const verifyWebhookSignature = vi.fn((..._args: unknown[]) => Promise.resolve(false));
const verifyTransaction = vi.fn((..._args: unknown[]) => Promise.resolve({}) as unknown);
const mapMonnifyPaymentMethod = vi.fn((..._args: unknown[]): "card" | "bank_transfer" | "ussd" | null => null);

vi.mock("@/lib/monnify", () => ({
  verifyWebhookSignature: (...args: unknown[]) => verifyWebhookSignature(...args),
  verifyTransaction: (...args: unknown[]) => verifyTransaction(...args),
  mapMonnifyPaymentMethod: (...args: unknown[]) => mapMonnifyPaymentMethod(...args),
}));

const adminClient = { current: supabaseClientMock() };
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => adminClient.current) }));

const { POST } = await import("./route");

function webhookRequest(body: string, signature: string | null = "sig"): Request {
  const headers = new Headers();
  if (signature !== null) headers.set("monnify-signature", signature);
  return new Request("http://localhost/api/webhooks/monnify", { method: "POST", body, headers });
}

const SUCCESS_BODY = JSON.stringify({
  eventType: "SUCCESSFUL_TRANSACTION",
  eventData: { transactionReference: "mnfy-txn-1", paymentReference: "KK-0001" },
});

const VERIFIED_PAID = {
  transactionReference: "mnfy-txn-1",
  paymentReference: "KK-0001",
  amountPaid: 5000, // Naira
  paymentStatus: "PAID" as const,
  paidOn: "2026-01-01T00:00:00Z",
  currency: "NGN",
  paymentMethod: "CARD",
};

beforeEach(() => {
  verifyWebhookSignature.mockReset();
  verifyTransaction.mockReset();
  mapMonnifyPaymentMethod.mockReset().mockReturnValue("card");
  adminClient.current = supabaseClientMock();
});

describe("Monnify webhook signature verification", () => {
  it("rejects a request with an invalid signature with 401, before parsing anything else", async () => {
    verifyWebhookSignature.mockResolvedValue(false);
    const res = await POST(webhookRequest(SUCCESS_BODY, "bad-signature"));
    expect(res.status).toBe(401);
    expect(verifyTransaction).not.toHaveBeenCalled();
  });

  it("rejects a request with no signature header at all", async () => {
    verifyWebhookSignature.mockResolvedValue(false);
    const res = await POST(webhookRequest(SUCCESS_BODY, null));
    expect(res.status).toBe(401);
  });

  it("verifies the signature against the raw body text, not a re-serialized parse of it", async () => {
    verifyWebhookSignature.mockResolvedValue(true);
    verifyTransaction.mockResolvedValue({ ...VERIFIED_PAID, paymentStatus: "PENDING" });
    const raw = SUCCESS_BODY;
    await POST(webhookRequest(raw, "sig"));
    expect(verifyWebhookSignature).toHaveBeenCalledWith(raw, "sig");
  });
});

describe("Monnify webhook payload handling", () => {
  beforeEach(() => {
    verifyWebhookSignature.mockResolvedValue(true);
  });

  it("returns 400 for malformed JSON even with a valid signature", async () => {
    const res = await POST(webhookRequest("{not json", "sig"));
    expect(res.status).toBe(400);
  });

  it("acknowledges non-success event types without re-verifying or capturing anything", async () => {
    const res = await POST(webhookRequest(JSON.stringify({ eventType: "FAILED_TRANSACTION" }), "sig"));
    expect(res.status).toBe(200);
    expect(verifyTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 when the payload is missing a transactionReference", async () => {
    const res = await POST(webhookRequest(JSON.stringify({ eventType: "SUCCESSFUL_TRANSACTION", eventData: {} }), "sig"));
    expect(res.status).toBe(400);
    expect(verifyTransaction).not.toHaveBeenCalled();
  });
});

describe("Monnify webhook trust boundary (never trusts the payload's own status/amount)", () => {
  beforeEach(() => {
    verifyWebhookSignature.mockResolvedValue(true);
  });

  it("ignores a webhook claiming success if Monnify's own verify endpoint disagrees (still PENDING)", async () => {
    verifyTransaction.mockResolvedValue({ ...VERIFIED_PAID, paymentStatus: "PENDING" });
    const res = await POST(webhookRequest(SUCCESS_BODY, "sig"));
    expect(res.status).toBe(200);
    expect(adminClient.current.rpc).not.toHaveBeenCalled();
  });

  it("captures on PAID", async () => {
    verifyTransaction.mockResolvedValue(VERIFIED_PAID);
    adminClient.current = supabaseClientMock({
      from: { orders: queryBuilder(ok({ id: "order-1" })) },
      rpc: { capture_payment: ok({ id: "order-1" }) },
    });
    const res = await POST(webhookRequest(SUCCESS_BODY, "sig"));
    expect(res.status).toBe(200);
  });

  it("also captures on OVERPAID, not just PAID", async () => {
    verifyTransaction.mockResolvedValue({ ...VERIFIED_PAID, paymentStatus: "OVERPAID" });
    adminClient.current = supabaseClientMock({
      from: { orders: queryBuilder(ok({ id: "order-1" })) },
      rpc: { capture_payment: ok({ id: "order-1" }) },
    });
    const res = await POST(webhookRequest(SUCCESS_BODY, "sig"));
    expect(res.status).toBe(200);
  });

  it("derives the captured amount from Monnify's verify response, never from the webhook body", async () => {
    // The webhook body carries no amount at all (see MonnifyWebhookPayload) —
    // this proves capture_payment's amount comes exclusively from the
    // re-verified `amountPaid`, converted Naira -> kobo at this one call site.
    verifyTransaction.mockResolvedValue({ ...VERIFIED_PAID, amountPaid: 12345.67 });
    const rpc = vi.fn(() => Promise.resolve(ok(null)));
    adminClient.current = supabaseClientMock({ from: { orders: queryBuilder(ok({ id: "order-1" })) } });
    adminClient.current.rpc = rpc as never;

    await POST(webhookRequest(SUCCESS_BODY, "sig"));
    expect(rpc).toHaveBeenCalledWith("capture_payment", expect.objectContaining({ p_amount_kobo: 1234567 }));
  });

  it("returns 404 and never calls capture_payment when no order matches the payment reference", async () => {
    verifyTransaction.mockResolvedValue(VERIFIED_PAID);
    adminClient.current = supabaseClientMock({ from: { orders: queryBuilder(ok(null)) } });
    const res = await POST(webhookRequest(SUCCESS_BODY, "sig"));
    expect(res.status).toBe(404);
    expect(adminClient.current.rpc).not.toHaveBeenCalled();
  });

  it("returns 500 (so Monnify retries) if capture_payment itself fails", async () => {
    verifyTransaction.mockResolvedValue(VERIFIED_PAID);
    adminClient.current = supabaseClientMock({
      from: { orders: queryBuilder(ok({ id: "order-1" })) },
      rpc: { capture_payment: { data: null, error: { message: "constraint violation" } } },
    });
    const res = await POST(webhookRequest(SUCCESS_BODY, "sig"));
    expect(res.status).toBe(500);
  });

  it("passes the re-verified transactionReference as the idempotency key's provider_ref and the paymentReference as the idempotency key itself", async () => {
    verifyTransaction.mockResolvedValue(VERIFIED_PAID);
    const rpc = vi.fn(() => Promise.resolve(ok(null)));
    adminClient.current = supabaseClientMock({ from: { orders: queryBuilder(ok({ id: "order-1" })) } });
    adminClient.current.rpc = rpc as never;

    await POST(webhookRequest(SUCCESS_BODY, "sig"));
    expect(rpc).toHaveBeenCalledWith(
      "capture_payment",
      expect.objectContaining({
        p_order_id: "order-1",
        p_provider: "monnify",
        p_provider_ref: "mnfy-txn-1",
        p_idempotency_key: "KK-0001",
      }),
    );
  });
});
