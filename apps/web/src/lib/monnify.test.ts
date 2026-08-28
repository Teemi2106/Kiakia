import { describe, expect, it } from "vitest";
import { mapMonnifyPaymentMethod } from "./monnify";

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

// verifyWebhookSignature's own test suite moved with it to
// supabase/functions/monnify-webhook/ — see that function's header comment.
