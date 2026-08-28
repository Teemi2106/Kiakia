// supabase/functions/monnify-webhook/monnify.test.ts
//
// Covers this function's pure, dependency-free pieces the same way
// apps/web/src/lib/monnify.test.ts covered the Next.js version before the
// webhook moved out — verifyTransaction/getAccessToken need a live Monnify
// sandbox and aren't unit-tested here (same boundary lib/monnify.ts drew:
// no mocking library is wired up in this Deno project, and dependency-
// injecting fetch just to unit test a thin HTTP wrapper isn't worth the
// structural change it'd force on index.ts).
//
// Run with: deno test --allow-env supabase/functions/monnify-webhook/

import { assertEquals } from "jsr:@std/assert@1";
import { mapMonnifyPaymentMethod, verifyWebhookSignature } from "./monnify.ts";

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.test("mapMonnifyPaymentMethod", async (t) => {
  await t.step("maps CARD to card", () => {
    assertEquals(mapMonnifyPaymentMethod("CARD"), "card");
  });

  await t.step("maps ACCOUNT_TRANSFER and BANK_TRANSFER to bank_transfer", () => {
    assertEquals(mapMonnifyPaymentMethod("ACCOUNT_TRANSFER"), "bank_transfer");
    assertEquals(mapMonnifyPaymentMethod("BANK_TRANSFER"), "bank_transfer");
  });

  await t.step("maps USSD to ussd", () => {
    assertEquals(mapMonnifyPaymentMethod("USSD"), "ussd");
  });

  await t.step("is case-insensitive", () => {
    assertEquals(mapMonnifyPaymentMethod("card"), "card");
  });

  await t.step("maps unrecognized values to null instead of guessing", () => {
    assertEquals(mapMonnifyPaymentMethod("CRYPTO"), null);
    assertEquals(mapMonnifyPaymentMethod(null), null);
  });
});

Deno.test("verifyWebhookSignature", async (t) => {
  const secret = "placeholder-monnify-api-secret";
  const body = JSON.stringify({ eventType: "SUCCESSFUL_TRANSACTION", eventData: { transactionReference: "abc123" } });

  await t.step("accepts a correctly signed body", async () => {
    Deno.env.set("MONNIFY_API_SECRET", secret);
    const signature = await sign(secret, body);
    assertEquals(await verifyWebhookSignature(body, signature), true);
  });

  await t.step("rejects a missing signature header", async () => {
    Deno.env.set("MONNIFY_API_SECRET", secret);
    assertEquals(await verifyWebhookSignature(body, null), false);
  });

  await t.step("rejects a tampered body (signature computed over the original payload)", async () => {
    Deno.env.set("MONNIFY_API_SECRET", secret);
    const signature = await sign(secret, body);
    const tamperedBody = JSON.stringify({
      eventType: "SUCCESSFUL_TRANSACTION",
      eventData: { transactionReference: "attacker-controlled" },
    });
    assertEquals(await verifyWebhookSignature(tamperedBody, signature), false);
  });

  await t.step("rejects a signature signed with the wrong secret", async () => {
    Deno.env.set("MONNIFY_API_SECRET", secret);
    const wrongSignature = await sign("wrong-secret", body);
    assertEquals(await verifyWebhookSignature(body, wrongSignature), false);
  });

  await t.step("rejects a malformed (non-hex, wrong-length) signature without throwing", async () => {
    Deno.env.set("MONNIFY_API_SECRET", secret);
    assertEquals(await verifyWebhookSignature(body, "not-a-real-signature"), false);
  });
});
