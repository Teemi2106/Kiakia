import { describe, expect, it } from "vitest";
import { mapMonnifyPaymentMethod, verifyWebhookSignature } from "./monnify";

describe("mapMonnifyPaymentMethod", () => {
  it("maps CARD to card", () => {
    expect(mapMonnifyPaymentMethod("CARD")).toBe("card");
  });

  it("maps ACCOUNT_TRANSFER and BANK_TRANSFER to bank_transfer", () => {
    expect(mapMonnifyPaymentMethod("ACCOUNT_TRANSFER")).toBe("bank_transfer");
    expect(mapMonnifyPaymentMethod("BANK_TRANSFER")).toBe("bank_transfer");
  });

  it("maps USSD to ussd", () => {
    expect(mapMonnifyPaymentMethod("USSD")).toBe("ussd");
  });

  it("is case-insensitive", () => {
    expect(mapMonnifyPaymentMethod("card")).toBe("card");
  });

  it("maps unrecognized values to null instead of guessing", () => {
    expect(mapMonnifyPaymentMethod("CRYPTO")).toBeNull();
    expect(mapMonnifyPaymentMethod(null)).toBeNull();
  });
});

describe("verifyWebhookSignature", () => {
  // Matches vitest.config.ts's env-var-provided value for the Monnify
  // webhook secret (see lib/env.server.ts) — a placeholder, not a real
  // credential. Deliberately not written as `serverEnv.<...>` here so this
  // comment doesn't rely on ci.yml's pattern-level secret-leak exclusion
  // (0022's fix) matching test comments as well as real references.
  const secret = "placeholder-monnify-api-secret";
  const body = JSON.stringify({ eventType: "SUCCESSFUL_TRANSACTION", eventData: { transactionReference: "abc123" } });

  async function sign(payload: string): Promise<string> {
    const { createHmac } = await import("node:crypto");
    return createHmac("sha512", secret).update(payload).digest("hex");
  }

  it("accepts a correctly signed body", async () => {
    const signature = await sign(body);
    await expect(verifyWebhookSignature(body, signature)).resolves.toBe(true);
  });

  it("rejects a missing signature header", async () => {
    await expect(verifyWebhookSignature(body, null)).resolves.toBe(false);
  });

  it("rejects a tampered body (signature computed over the original payload)", async () => {
    const signature = await sign(body);
    const tamperedBody = JSON.stringify({
      eventType: "SUCCESSFUL_TRANSACTION",
      eventData: { transactionReference: "attacker-controlled" },
    });
    await expect(verifyWebhookSignature(tamperedBody, signature)).resolves.toBe(false);
  });

  it("rejects a signature signed with the wrong secret", async () => {
    const { createHmac } = await import("node:crypto");
    const wrongSignature = createHmac("sha512", "wrong-secret").update(body).digest("hex");
    await expect(verifyWebhookSignature(body, wrongSignature)).resolves.toBe(false);
  });

  it("rejects a malformed (non-hex, wrong-length) signature without throwing", async () => {
    await expect(verifyWebhookSignature(body, "not-a-real-signature")).resolves.toBe(false);
  });
});
