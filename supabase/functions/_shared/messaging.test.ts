// supabase/functions/_shared/messaging.test.ts
//
// Unit tests for messaging.ts. Written against node:test + node:assert so the
// same file runs under either runtime (Deno implements both):
//   node --test supabase/functions/_shared/messaging.test.ts      (Node >= 22.18)
//   deno test --allow-env supabase/functions/_shared/
// No network: the adapters take an injectable fetch. Provider-specific response
// shapes below are written from the providers' public docs as remembered, NOT
// captured from live calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  base64UrlDecode,
  base64UrlEncode,
  buildEmail,
  buildSms,
  classifyResendStatus,
  emailUnsubscribeUrl,
  escapeHtml,
  loadConfig,
  normalizeNigerianNumber,
  type OutboxRow,
  parseResendEvent,
  parseTermiiEvent,
  sanitizeSubject,
  sendEmailViaResend,
  sendSmsViaTermii,
  sendViaFake,
  signUnsubscribeToken,
  smsUnsubscribeUrl,
  timingSafeEqual,
  verifySvixSignature,
  verifyUnsubscribeToken,
} from "./messaging.ts";

const UID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OUTBOX = "bf100000-0000-7000-8000-0000000000a1";

const cfg = loadConfig((n) =>
  ({
    RESEND_API_KEY: "re_test_key",
    MESSAGE_FROM_EMAIL: "KiaKia <noreply@mail.example.com>",
    TERMII_API_KEY: "TL_test_key",
    TERMII_SENDER_ID: "KiaKia",
    SITE_URL: "https://kiakia.example/",
    MESSAGE_UNSUBSCRIBE_SECRET: "s3cret",
  } as Record<string, string>)[n]
);

function row(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: OUTBOX, channel: "email", category: "transactional", kind: "direct",
    recipient_user_id: UID, to_address: "ada@example.com", subject: "Hello", body: "Body", attempts: 1, ...over,
  };
}

function fakeFetch(status: number, json: unknown, capture?: { url?: string; init?: RequestInit }) {
  return (url: string, init: RequestInit) => {
    if (capture) { capture.url = url; capture.init = init; }
    return Promise.resolve(new Response(JSON.stringify(json), { status }));
  };
}

// --- number normalisation -------------------------------------------------

test("normalizeNigerianNumber", () => {
  const ok: Array<[string, string]> = [
    ["+2348012345678", "2348012345678"],
    ["2348012345678", "2348012345678"],
    ["08012345678", "2348012345678"],
    ["8012345678", "2348012345678"],
    ["0803 123 4567", "2348031234567"],
    ["(0803)-123-4567", "2348031234567"],
    ["+234 (0) 803 123 4567".replace("(0) ", "0"), "2348031234567"],
    ["002348012345678", "2348012345678"],
    ["09012345678", "2349012345678"],
    ["07012345678", "2347012345678"],
  ];
  for (const [input, expected] of ok) assert.equal(normalizeNigerianNumber(input), expected, input);
  for (const bad of ["", null, undefined, "12345", "+14155550123", "0801234567", "080123456789", "abc", "+2341234567890", "0601234567"]) {
    assert.equal(normalizeNigerianNumber(bad as string), null, String(bad));
  }
});

// --- unsubscribe token ----------------------------------------------------

test("signUnsubscribeToken follows the documented format exactly", async () => {
  const token = await signUnsubscribeToken(UID, "email", "s3cret");
  const [b64, mac] = token.split(".");
  assert.equal(Buffer.from(b64, "base64url").toString("utf8"), `${UID}.email`);
  assert.equal(mac, createHmac("sha256", "s3cret").update(`${UID}.email`).digest("hex"));
  assert.match(b64, /^[A-Za-z0-9_-]+$/);
  assert.equal(token.split(".").length, 2);
});

test("verifyUnsubscribeToken round-trips and rejects tampering", async () => {
  for (const channel of ["email", "sms"] as const) {
    const token = await signUnsubscribeToken(UID, channel, "s3cret");
    assert.deepEqual(await verifyUnsubscribeToken(token, "s3cret"), { userId: UID, channel });
  }
  const token = await signUnsubscribeToken(UID, "email", "s3cret");
  assert.equal(await verifyUnsubscribeToken(token, "other-secret"), null, "wrong secret");
  // swap the channel inside the payload but keep the old MAC
  const forged = base64UrlEncode(`${UID}.sms`) + "." + token.split(".")[1];
  assert.equal(await verifyUnsubscribeToken(forged, "s3cret"), null, "channel swap");
  // different user, same MAC
  const other = base64UrlEncode(`${UID.replace("0a1b", "ffff")}.email`) + "." + token.split(".")[1];
  assert.equal(await verifyUnsubscribeToken(other, "s3cret"), null, "user swap");
  for (const junk of ["", ".", "abc", "a.b.c", token + "00", token.slice(0, -2), "!!!." + token.split(".")[1]]) {
    assert.equal(await verifyUnsubscribeToken(junk, "s3cret"), null, junk);
  }
  assert.equal(await verifyUnsubscribeToken(token, ""), null, "empty secret never verifies");
  await assert.rejects(() => signUnsubscribeToken(UID, "email", ""), /not configured/);
});

test("base64url helpers", () => {
  assert.equal(base64UrlEncode("a?b>c"), Buffer.from("a?b>c").toString("base64url"));
  assert.equal(base64UrlDecode(base64UrlEncode("héllo")), "héllo");
  assert.equal(base64UrlDecode("***"), null);
});

test("unsubscribe URLs", () => {
  assert.equal(emailUnsubscribeUrl("https://k.ng/", "T"), "https://k.ng/unsubscribe?token=T");
  assert.equal(smsUnsubscribeUrl("https://k.ng", "T"), "https://k.ng/u/T");
});

// --- constant-time compare ------------------------------------------------

test("timingSafeEqual", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", ""), true);
  assert.equal(timingSafeEqual("", "a"), false);
});

// --- email rendering ------------------------------------------------------

test("buildEmail escapes HTML, keeps newlines and only adds the footer when asked", () => {
  const e = buildEmail({ subject: "Hi\r\nBcc: x@y.z", body: `<script>alert("x")</script> & more\nsecond line` });
  assert.ok(!e.html.includes("<script>"));
  assert.ok(e.html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more<br>\nsecond line"));
  assert.ok(!e.html.toLowerCase().includes("unsubscribe"));
  assert.equal(e.subject, "Hi Bcc: x@y.z", "CR/LF can never survive into the subject header");
  assert.equal(e.text, `<script>alert("x")</script> & more\nsecond line`);

  const p = buildEmail({ subject: "S", body: "B", unsubscribeUrl: "https://k.ng/unsubscribe?token=a.b" });
  assert.ok(p.html.includes('href="https://k.ng/unsubscribe?token=a.b"'));
  assert.ok(p.text.endsWith("Unsubscribe: https://k.ng/unsubscribe?token=a.b"));
  assert.equal(escapeHtml(`'"<>&`), "&#39;&quot;&lt;&gt;&amp;");
  assert.equal(sanitizeSubject("x".repeat(400)).length, 150);
});

test("buildSms appends the opt-out line only when given", () => {
  assert.equal(buildSms("Hello"), "Hello");
  assert.equal(buildSms("Hello", "https://k.ng/u/T"), "Hello\nOpt out: https://k.ng/u/T");
});

// --- Resend adapter -------------------------------------------------------

test("sendEmailViaResend sends the documented request and returns the provider id", async () => {
  const cap: { url?: string; init?: RequestInit } = {};
  const email = buildEmail({ subject: "Hello", body: "Body", unsubscribeUrl: "https://k.ng/unsubscribe?token=t" });
  const r = await sendEmailViaResend(cfg, row({ category: "promotional" }), email, "https://k.ng/unsubscribe?token=t",
    fakeFetch(200, { id: "re_123" }, cap));
  assert.deepEqual(r, { ok: true, providerMessageId: "re_123" });
  assert.equal(cap.url, "https://api.resend.com/emails");
  const h = cap.init!.headers as Record<string, string>;
  assert.equal(h["Idempotency-Key"], OUTBOX);
  assert.equal(h.Authorization, "Bearer re_test_key");
  const body = JSON.parse(cap.init!.body as string);
  assert.deepEqual(body.to, ["ada@example.com"]);
  assert.equal(body.from, "KiaKia <noreply@mail.example.com>");
  assert.deepEqual(body.tags[0], { name: "outbox_id", value: OUTBOX });
  assert.equal(body.headers["List-Unsubscribe"], "<https://k.ng/unsubscribe?token=t>");
  assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click", "RFC 8058 one-click is on by default (the web app handles POST /unsubscribe)");
});

test("sendEmailViaResend classifies failures and never leaks the address", async () => {
  const email = buildEmail({ subject: "s", body: "b" });
  const perm = await sendEmailViaResend(cfg, row(), email, undefined,
    fakeFetch(422, { name: "validation_error", message: "The to address ada@example.com is invalid" }));
  assert.deepEqual(perm, { ok: false, permanent: true, error: "resend_http_422:validation_error" });
  assert.ok(!JSON.stringify(perm).includes("ada@"));
  for (const status of [401, 403, 409, 429, 500, 503]) {
    const r = await sendEmailViaResend(cfg, row(), email, undefined, fakeFetch(status, { name: "x" }));
    assert.equal(r.ok === false && r.permanent, false, String(status));
  }
  const net = await sendEmailViaResend(cfg, row(), email, undefined, () => Promise.reject(new Error("boom ada@example.com")));
  assert.deepEqual(net, { ok: false, permanent: false, error: "resend_network_error" });
  const noKey = await sendEmailViaResend({ ...cfg, resendApiKey: "" }, row(), email, undefined, fakeFetch(200, { id: "x" }));
  assert.deepEqual(noKey, { ok: false, permanent: false, error: "provider_not_configured: resend" });
  assert.equal(classifyResendStatus(422), true);
  assert.equal(classifyResendStatus(429), false);
});

// --- Termii adapter -------------------------------------------------------

test("sendSmsViaTermii: route by category, normalised number, provider id", async () => {
  const cap: { url?: string; init?: RequestInit } = {};
  const tx = await sendSmsViaTermii(cfg, row({ channel: "sms", to_address: "+2348012345678" }), "hello",
    fakeFetch(200, { code: "ok", message_id: "m-1", message: "Successfully Sent" }, cap));
  assert.deepEqual(tx, { ok: true, providerMessageId: "m-1" });
  assert.equal(cap.url, "https://api.ng.termii.com/api/sms/send");
  let body = JSON.parse(cap.init!.body as string);
  assert.equal(body.to, "2348012345678");
  assert.equal(body.channel, "dnd", "transactional -> dnd route");
  assert.equal(body.from, "KiaKia");
  assert.equal(body.type, "plain");
  assert.equal(body.api_key, "TL_test_key");

  await sendSmsViaTermii(cfg, row({ channel: "sms", category: "promotional", to_address: "08012345678" }), "promo",
    fakeFetch(200, { message_id: "m-2" }, cap));
  body = JSON.parse(cap.init!.body as string);
  assert.equal(body.channel, "generic", "promotional -> generic route");
  assert.equal(body.to, "2348012345678");

  await sendSmsViaTermii({ ...cfg, termiiTransactionalChannel: "generic" }, row({ channel: "sms", to_address: "08012345678" }), "x",
    fakeFetch(200, { message_id: "m-3" }, cap));
  assert.equal(JSON.parse(cap.init!.body as string).channel, "generic", "transactional route is overridable");
});

test("sendSmsViaTermii failure classification", async () => {
  const sms = row({ channel: "sms", to_address: "+2348012345678" });
  const invalid = await sendSmsViaTermii(cfg, row({ channel: "sms", to_address: "+14155550123" }), "x", fakeFetch(200, {}));
  assert.deepEqual(invalid, { ok: false, permanent: true, error: "invalid_phone" });
  const bad = await sendSmsViaTermii(cfg, sms, "x", fakeFetch(400, { message: "Invalid sender id" }));
  assert.equal(bad.ok === false && bad.permanent, true);
  const bal = await sendSmsViaTermii(cfg, sms, "x", fakeFetch(400, { message: "Insufficient balance" }));
  assert.equal(bal.ok === false && bal.permanent, false, "insufficient balance is retried");
  for (const status of [401, 403, 429, 500, 502]) {
    const r = await sendSmsViaTermii(cfg, sms, "x", fakeFetch(status, { message: "x" }));
    assert.equal(r.ok === false && r.permanent, false, String(status));
  }
  const noId = await sendSmsViaTermii(cfg, sms, "x", fakeFetch(200, { code: "ok" }));
  assert.equal(noId.ok === false && noId.permanent, false, "a 200 without message_id is not trusted");
  const leak = await sendSmsViaTermii(cfg, sms, "x", fakeFetch(400, { message: "Invalid number 2348012345678" }));
  assert.ok(leak.ok === false && !leak.error.includes("2348012345678"), "phone numbers are masked in errors");
  const net = await sendSmsViaTermii(cfg, sms, "x", () => Promise.reject(new Error("down")));
  assert.deepEqual(net, { ok: false, permanent: false, error: "termii_network_error" });
  const noKey = await sendSmsViaTermii({ ...cfg, termiiApiKey: "" }, sms, "x", fakeFetch(200, { message_id: "1" }));
  assert.deepEqual(noKey, { ok: false, permanent: false, error: "provider_not_configured: termii" });
});

test("fake provider is deterministic and offline", () => {
  assert.deepEqual(sendViaFake(row()), { ok: true, providerMessageId: `fake_${OUTBOX}` });
  assert.deepEqual(sendViaFake(row({ to_address: "bounce@example.com" })), { ok: false, permanent: true, error: "fake_permanent_failure" });
  assert.deepEqual(sendViaFake(row({ to_address: "Flaky@example.com" })), { ok: false, permanent: false, error: "fake_transient_failure" });
  assert.equal(loadConfig(() => undefined).mode, "live");
  assert.equal(loadConfig((n) => (n === "MESSAGE_PROVIDER_MODE" ? "FAKE" : undefined)).mode, "fake");
});

// --- Svix / Resend webhook ------------------------------------------------

function svixSign(secretB64: string, id: string, ts: string, body: string): string {
  return "v1," + createHmac("sha256", Buffer.from(secretB64, "base64")).update(`${id}.${ts}.${body}`).digest("base64");
}

test("verifySvixSignature", async () => {
  const secretB64 = Buffer.from("super-secret-bytes-1234567890").toString("base64");
  const secret = `whsec_${secretB64}`;
  const id = "msg_abc";
  const now = 1_800_000_000_000;
  const ts = String(now / 1000);
  const body = '{"type":"email.delivered"}';
  const sig = svixSign(secretB64, id, ts, body);
  const base = { secret, id, timestamp: ts, signature: sig, rawBody: body, nowMs: now };

  assert.equal(await verifySvixSignature(base), true);
  assert.equal(await verifySvixSignature({ ...base, signature: `v1,AAAA ${sig}` }), true, "any listed signature may match");
  assert.equal(await verifySvixSignature({ ...base, rawBody: body + " " }), false, "tampered body");
  assert.equal(await verifySvixSignature({ ...base, id: "msg_other" }), false, "different message id");
  assert.equal(await verifySvixSignature({ ...base, secret: "whsec_" + Buffer.from("other").toString("base64") }), false, "wrong secret");
  assert.equal(await verifySvixSignature({ ...base, nowMs: now + 301_000 }), false, "stale timestamp (replay)");
  assert.equal(await verifySvixSignature({ ...base, nowMs: now - 301_000 }), false, "future timestamp");
  assert.equal(await verifySvixSignature({ ...base, signature: sig.replace("v1,", "v2,") }), false, "unknown version");
  assert.equal(await verifySvixSignature({ ...base, secret: "" }), false, "no secret configured");
  assert.equal(await verifySvixSignature({ ...base, signature: null }), false);
  assert.equal(await verifySvixSignature({ ...base, timestamp: "abc" }), false);
});

test("parseResendEvent", () => {
  const tags = [{ name: "outbox_id", value: OUTBOX }];
  assert.deepEqual(parseResendEvent({ type: "email.delivered", data: { email_id: "e1", tags } }),
    { event: "delivered", outboxId: OUTBOX, providerMessageId: "e1", detail: null });
  assert.equal(parseResendEvent({ type: "email.delivered", data: { email_id: "e1", tags: { outbox_id: OUTBOX } } }).outboxId, OUTBOX, "tags as an object");
  assert.equal(parseResendEvent({ type: "email.delivered", data: { tags: [{ name: "outbox_id", value: "not-a-uuid" }] } }).outboxId, null);
  assert.equal(parseResendEvent({ type: "email.bounced", data: { email_id: "e", bounce: { type: "Permanent", subType: "General" } } }).event, "bounced");
  assert.equal(parseResendEvent({ type: "email.bounced", data: { email_id: "e", bounce: { type: "Transient" } } }).event, "failed", "a soft bounce does not withdraw consent");
  assert.equal(parseResendEvent({ type: "email.complained", data: { email_id: "e" } }).event, "complained");
  for (const type of ["email.sent", "email.opened", "email.clicked", "email.delivery_delayed", "contact.created", ""]) {
    assert.equal(parseResendEvent({ type, data: {} }).event, null, type);
  }
  assert.equal(parseResendEvent(null).event, null);
});

test("parseTermiiEvent", () => {
  assert.deepEqual(parseTermiiEvent({ message_id: "m1", status: "Delivered" }), { event: "delivered", providerMessageId: "m1", detail: null });
  assert.equal(parseTermiiEvent({ message_id: "m1", status: "Message Failed" }).event, "failed");
  assert.equal(parseTermiiEvent({ message_id: "m1", status: "DND Active on Phone Number" }).event, "failed");
  assert.equal(parseTermiiEvent({ message_id: "m1", status: "Rejected" }).event, "failed");
  assert.equal(parseTermiiEvent({ message_id: "m1", status: "Undelivered" }).event, "failed");
  assert.equal(parseTermiiEvent({ message_id: "m1", status: "Sent" }).event, null);
  assert.equal(parseTermiiEvent({ status: "Delivered" }).providerMessageId, null);
  assert.equal(parseTermiiEvent("junk").event, null);
});
