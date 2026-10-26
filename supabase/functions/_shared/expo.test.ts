// supabase/functions/_shared/expo.test.ts
//
// Unit tests for expo.ts (shared by dispatch-push and message-worker). Written
// against node:test + node:assert like messaging.test.ts, so the same file runs
// under either runtime:
//   node --test supabase/functions/_shared/expo.test.ts      (Node >= 22.18)
//   deno test --allow-env supabase/functions/_shared/
// No network: sendExpoPushMessages / sendOutboxPush take an injectable fetch.
// Expo's response shapes are written from its public docs as remembered, NOT
// captured from live calls. (Replaces dispatch-push/expo.test.ts, whose cases
// for buildOfferPushMessages and deadTokensFrom are kept below.)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOfferPushMessages,
  buildOutboxPushMessages,
  deadTokensFrom,
  EXPO_PUSH_URL,
  type ExpoPushTicket,
  interpretExpoTickets,
  sendExpoPushMessages,
  sendOutboxPush,
  ttlSecondsFor,
} from "./expo.ts";

// ---- carried over from dispatch-push/expo.test.ts -------------------------

test("buildOfferPushMessages: one message per token, vendor in the body, order id in data", () => {
  const messages = buildOfferPushMessages({
    tokens: ["ExponentPushToken[a]", "ExponentPushToken[b]"],
    vendorName: "Amala Spot",
    orderId: "order-1",
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].to, "ExponentPushToken[a]");
  assert.equal(messages[1].to, "ExponentPushToken[b]");
  assert.equal(messages[0].body, "Pickup from Amala Spot. Tap to see it.");
  assert.deepEqual(messages[0].data, { type: "dispatch_offer", orderId: "order-1" });
  assert.equal(messages[0].channelId, "offers", "must match the rider app's Android channel");
  assert.equal("ttl" in messages[0], false, "the legacy message shape is unchanged (no ttl)");
  assert.deepEqual(buildOfferPushMessages({ tokens: [], vendorName: "V", orderId: "o" }), []);
});

test("deadTokensFrom: DeviceNotRegistered only, matched positionally", () => {
  const tokens = ["t1", "t2", "t3"];
  const tickets: ExpoPushTicket[] = [
    { status: "ok", id: "r1" },
    { status: "error", details: { error: "DeviceNotRegistered" } },
    { status: "error", details: { error: "MessageRateExceeded" } },
  ];
  assert.deepEqual(deadTokensFrom(tokens, tickets), ["t2"]);
  assert.deepEqual(deadTokensFrom(tokens, tokens.map(() => ({ status: "ok" as const }))), []);
});

// ---- new -------------------------------------------------------------------

test("buildOutboxPushMessages: title/body/data from the outbox row, ttl only when given", () => {
  const data = { type: "dispatch_offer", orderId: "o1", offerId: "f1" };
  const [m] = buildOutboxPushMessages({ tokens: ["t"], title: "New delivery", body: "Pickup from X. Tap to see it.", data, ttlSeconds: 40 });
  assert.deepEqual(m, {
    to: "t", title: "New delivery", body: "Pickup from X. Tap to see it.", sound: "default", priority: "high",
    channelId: "offers", data, ttl: 40,
  });
  assert.equal("ttl" in buildOutboxPushMessages({ tokens: ["t"], title: "a", body: "b", data })[0], false);
});

test("ttlSecondsFor: seconds to expiry, clamped to 1..3600, undefined when unset", () => {
  const now = new Date("2026-10-25T10:00:00Z");
  assert.equal(ttlSecondsFor("2026-10-25T10:00:45Z", now), 45);
  assert.equal(ttlSecondsFor("2026-10-25T09:00:00Z", now), 1, "already expired still gets 1 s");
  assert.equal(ttlSecondsFor("2026-10-26T10:00:00Z", now), 3600);
  assert.equal(ttlSecondsFor(null, now), undefined);
  assert.equal(ttlSecondsFor("garbage", now), undefined);
});

test("interpretExpoTickets", () => {
  const dnr: ExpoPushTicket = { status: "error", details: { error: "DeviceNotRegistered" } };
  const rate: ExpoPushTicket = { status: "error", details: { error: "MessageRateExceeded" } };
  assert.deepEqual(interpretExpoTickets(["a"], [{ status: "ok", id: "tk1" }]), { kind: "sent", providerMessageId: "tk1", dead: [] });
  assert.deepEqual(interpretExpoTickets(["a"], [{ status: "ok" }]), { kind: "sent", providerMessageId: "expo", dead: [] });
  // one device gone, one fine: sent, and the dead one is pruned
  assert.deepEqual(interpretExpoTickets(["a", "b"], [dnr, { status: "ok", id: "tk2" }]), { kind: "sent", providerMessageId: "tk2", dead: ["a"] });
  // every device gone: nothing left to push to - suppressed, not failed
  assert.deepEqual(interpretExpoTickets(["a", "b"], [dnr, dnr]), { kind: "no_tokens", dead: ["a", "b"] });
  // other errors are retryable ...
  assert.deepEqual(interpretExpoTickets(["a"], [rate]), { kind: "failed", permanent: false, error: "expo_ticket_MessageRateExceeded", dead: [] });
  // ... except the ones that can never succeed
  assert.deepEqual(
    interpretExpoTickets(["a"], [{ status: "error", details: { error: "MessageTooBig" } }]),
    { kind: "failed", permanent: true, error: "expo_ticket_MessageTooBig", dead: [] },
  );
  assert.equal((interpretExpoTickets(["a"], [{ status: "error", details: { error: "InvalidCredentials" } }]) as { permanent: boolean }).permanent, true);
  // dead + retryable error: the retryable one decides (the dead token is still pruned)
  assert.deepEqual(interpretExpoTickets(["a", "b"], [dnr, rate]), { kind: "failed", permanent: false, error: "expo_ticket_MessageRateExceeded", dead: ["a"] });
  assert.deepEqual(interpretExpoTickets(["a"], [{ status: "error" }]), { kind: "failed", permanent: false, error: "expo_ticket_unknown", dead: [] });
  assert.equal((interpretExpoTickets(["a"], []) as { error: string }).error, "expo_no_tickets");
  // an error code with odd characters never reaches message_outbox.error verbatim
  assert.equal(
    (interpretExpoTickets(["a"], [{ status: "error", details: { error: "bad code <script>" } }]) as { error: string }).error,
    "expo_ticket_unknown",
  );
});

type Capture = { url?: string; init?: RequestInit; calls: number };

function fakeFetch(status: number, body: unknown, capture?: Capture) {
  return (url: string, init: RequestInit) => {
    if (capture) {
      capture.url = url;
      capture.init = init;
      capture.calls += 1;
    }
    return Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  };
}

const ROW = {
  id: "bf100000-0000-7000-8000-0000000000a1",
  subject: "New delivery",
  body: "Pickup from Amala Spot. Tap to see it.",
  data: { type: "dispatch_offer", orderId: "o1", offerId: "f1" },
  expires_at: "2026-10-25T10:00:45Z",
};
const NOW = new Date("2026-10-25T10:00:00Z");
const ONE = buildOfferPushMessages({ tokens: ["t"], vendorName: "V", orderId: "o" });

test("sendExpoPushMessages: POSTs the array to Expo, returns the tickets", async () => {
  const cap: Capture = { calls: 0 };
  const tickets = await sendExpoPushMessages(
    buildOfferPushMessages({ tokens: ["t1"], vendorName: "V", orderId: "o" }),
    fakeFetch(200, { data: [{ status: "ok", id: "x" }] }, cap),
  );
  assert.deepEqual(tickets, [{ status: "ok", id: "x" }]);
  assert.equal(cap.url, EXPO_PUSH_URL);
  assert.equal(cap.init?.method, "POST");
  assert.equal(JSON.parse(cap.init!.body as string)[0].to, "t1");
  assert.deepEqual(await sendExpoPushMessages([], fakeFetch(500, "never called")), [], "no messages: no request");
});

test("sendExpoPushMessages: non-2xx and request-level errors throw (dispatch-push relies on that)", async () => {
  await assert.rejects(sendExpoPushMessages(ONE, fakeFetch(503, "down")), /Expo push API returned 503: down/);
  await assert.rejects(sendExpoPushMessages(ONE, fakeFetch(200, { errors: [{ code: "X" }] })), /rejected the request/);
});

test("sendOutboxPush: no tokens -> no_tokens without calling Expo", async () => {
  const cap: Capture = { calls: 0 };
  assert.deepEqual(await sendOutboxPush(ROW, [], fakeFetch(200, { data: [] }, cap), NOW), { kind: "no_tokens", dead: [] });
  assert.equal(cap.calls, 0);
});

test("sendOutboxPush: sends title/body/data/ttl to every token and reports sent", async () => {
  const cap: Capture = { calls: 0 };
  const out = await sendOutboxPush(ROW, ["t1", "t2"], fakeFetch(200, { data: [{ status: "ok", id: "k1" }, { status: "ok", id: "k2" }] }, cap), NOW);
  assert.deepEqual(out, { kind: "sent", providerMessageId: "k1", dead: [] });
  assert.equal(cap.calls, 1, "one request for all tokens");
  const sent = JSON.parse(cap.init!.body as string);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], {
    to: "t2", title: "New delivery", body: ROW.body, sound: "default", priority: "high", channelId: "offers", data: ROW.data, ttl: 45,
  });
});

test("sendOutboxPush: a withdrawn push carries its own type; a missing subject falls back", async () => {
  const cap: Capture = { calls: 0 };
  await sendOutboxPush(
    { ...ROW, subject: null, data: { type: "dispatch_offer_withdrawn", orderId: "o1", offerId: "f1" } },
    ["t"],
    fakeFetch(200, { data: [{ status: "ok" }] }, cap),
    NOW,
  );
  const [m] = JSON.parse(cap.init!.body as string);
  assert.equal(m.title, "KiaKia");
  assert.equal(m.data.type, "dispatch_offer_withdrawn");
});

test("sendOutboxPush: DeviceNotRegistered prunes; all dead = suppressed", async () => {
  const dnr = { status: "error", details: { error: "DeviceNotRegistered" } };
  assert.deepEqual(
    await sendOutboxPush(ROW, ["a", "b"], fakeFetch(200, { data: [dnr, { status: "ok", id: "k" }] }), NOW),
    { kind: "sent", providerMessageId: "k", dead: ["a"] },
  );
  assert.deepEqual(await sendOutboxPush(ROW, ["a"], fakeFetch(200, { data: [dnr] }), NOW), { kind: "no_tokens", dead: ["a"] });
});

test("sendOutboxPush: transport failures map to retryable/permanent without leaking tokens or bodies", async () => {
  const secretBody = "Bearer-sekret ExponentPushToken[abc]";
  const cases: [number, boolean][] = [[500, false], [503, false], [429, false], [408, false], [400, true], [401, true], [413, true]];
  for (const [status, permanent] of cases) {
    const out = await sendOutboxPush(ROW, ["ExponentPushToken[abc]"], fakeFetch(status, secretBody), NOW);
    assert.deepEqual(out, { kind: "failed", permanent, error: `expo_http_${status}`, dead: [] }, `HTTP ${status}`);
  }
  const net = await sendOutboxPush(ROW, ["t"], () => Promise.reject(new TypeError("fetch failed: ExponentPushToken[abc]")), NOW);
  assert.deepEqual(net, { kind: "failed", permanent: false, error: "expo_error", dead: [] });
  const rejected = await sendOutboxPush(
    ROW,
    ["t"],
    fakeFetch(200, { errors: [{ code: "VALIDATION_ERROR", message: "ExponentPushToken[abc]" }] }),
    NOW,
  );
  assert.deepEqual(rejected, { kind: "failed", permanent: false, error: "expo_error", dead: [] });
});
