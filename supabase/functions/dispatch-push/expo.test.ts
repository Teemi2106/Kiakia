// supabase/functions/dispatch-push/expo.test.ts
//
// Covers the pure pieces of expo.ts. sendExpoPushMessages() itself needs a
// live network call to Expo's push API and isn't unit-tested here — same
// boundary monnify.test.ts draws around verifyTransaction/getAccessToken.
//
// Run with: deno test --allow-env supabase/functions/dispatch-push/

import { assertEquals } from "jsr:@std/assert@1";
import { buildOfferPushMessages, deadTokensFrom, type ExpoPushTicket } from "./expo.ts";

Deno.test("buildOfferPushMessages", async (t) => {
  await t.step("builds one message per token, addressed correctly", () => {
    const messages = buildOfferPushMessages({
      tokens: ["ExponentPushToken[a]", "ExponentPushToken[b]"],
      vendorName: "Amala Spot",
      orderId: "order-1",
    });

    assertEquals(messages.length, 2);
    assertEquals(messages[0].to, "ExponentPushToken[a]");
    assertEquals(messages[1].to, "ExponentPushToken[b]");
  });

  await t.step("names the vendor in the body", () => {
    const [message] = buildOfferPushMessages({
      tokens: ["t"],
      vendorName: "Amala Spot",
      orderId: "order-1",
    });
    assertEquals(message.body, "Pickup from Amala Spot. Tap to see it.");
  });

  await t.step("carries the order id in data for deep-linking", () => {
    const [message] = buildOfferPushMessages({
      tokens: ["t"],
      vendorName: "Amala Spot",
      orderId: "order-42",
    });
    assertEquals(message.data, { type: "dispatch_offer", orderId: "order-42" });
  });

  await t.step("targets the app's own Android notification channel", () => {
    // Must match ensureAndroidChannel()'s channel id in
    // kiakia-rider/src/features/notifications/push.ts, or Android delivers
    // this silently with no heads-up banner.
    const [message] = buildOfferPushMessages({ tokens: ["t"], vendorName: "V", orderId: "o" });
    assertEquals(message.channelId, "offers");
  });

  await t.step("returns an empty array for no tokens", () => {
    assertEquals(buildOfferPushMessages({ tokens: [], vendorName: "V", orderId: "o" }), []);
  });
});

Deno.test("deadTokensFrom", async (t) => {
  const tokens = ["t1", "t2", "t3"];

  await t.step("returns tokens whose ticket reports DeviceNotRegistered", () => {
    const tickets: ExpoPushTicket[] = [
      { status: "ok", id: "receipt-1" },
      { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } },
      { status: "ok", id: "receipt-3" },
    ];
    assertEquals(deadTokensFrom(tokens, tickets), ["t2"]);
  });

  await t.step("ignores other error kinds — those are not necessarily dead", () => {
    const tickets: ExpoPushTicket[] = [
      { status: "error", message: "rate limited", details: { error: "MessageRateExceeded" } },
      { status: "ok", id: "receipt-2" },
      { status: "ok", id: "receipt-3" },
    ];
    assertEquals(deadTokensFrom(tokens, tickets), []);
  });

  await t.step("returns an empty array when every ticket is ok", () => {
    const tickets: ExpoPushTicket[] = tokens.map(() => ({ status: "ok" as const, id: "r" }));
    assertEquals(deadTokensFrom(tokens, tickets), []);
  });

  await t.step("matches tickets to tokens positionally, not by content", () => {
    // Expo's response array is documented to be the same order and length
    // as the request array — this is what makes positional matching valid.
    const tickets: ExpoPushTicket[] = [
      { status: "ok" },
      { status: "ok" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ];
    assertEquals(deadTokensFrom(tokens, tickets), ["t3"]);
  });
});
