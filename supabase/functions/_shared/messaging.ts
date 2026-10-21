// supabase/functions/_shared/messaging.ts
//
// Pure(ish) building blocks for message-worker and message-webhooks:
// Nigerian number normalisation, plain-text -> safe HTML, the unsubscribe
// token (the Next.js unsubscribe page verifies it; the format below is a
// CONTRACT), constant-time compare, Svix (Resend) webhook verification, the
// Resend and Termii adapters (fetch is injectable so nothing here needs the
// network under test) and a fake provider.
//
// Uses only Web APIs (crypto.subtle, TextEncoder, fetch, atob/btoa) and no
// Deno globals, so the same file is unit-tested under Deno or Node (see
// messaging.test.ts). No function here logs, and none puts a message body or
// address in an error string: error strings end up in message_outbox.error,
// which admins read.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Channel = "email" | "sms";
export type Category = "transactional" | "promotional";

/** A claimed message_outbox row (the columns the worker uses). */
export interface OutboxRow {
  id: string;
  channel: Channel;
  category: Category;
  kind: string;
  recipient_user_id: string | null;
  to_address: string | null;
  subject: string | null;
  body: string;
  attempts: number;
}

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; permanent: boolean; error: string };

// ---------------------------------------------------------------------------
// Constant-time comparison
// ---------------------------------------------------------------------------

/** Compares two strings in time independent of where they differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function base64UrlDecode(token: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(token)) return null;
  const padded = token.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (token.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(keyBytes), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
}

// ---------------------------------------------------------------------------
// Unsubscribe token  (CONTRACT with the Next.js /unsubscribe page)
//   token = base64url(`${user_id}.${channel}`) + "." + hex(HMAC-SHA256(secret, `${user_id}.${channel}`))
//   channel is "email" or "sms"
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function signUnsubscribeToken(userId: string, channel: Channel, secret: string): Promise<string> {
  if (!secret) throw new Error("unsubscribe secret is not configured");
  const payload = `${userId}.${channel}`;
  const mac = await hmacSha256(new TextEncoder().encode(secret), payload);
  return `${base64UrlEncode(payload)}.${toHex(mac)}`;
}

/** Returns {userId, channel} for a valid token, null otherwise. Constant-time MAC compare. */
export async function verifyUnsubscribeToken(
  token: string,
  secret: string,
): Promise<{ userId: string; channel: Channel } | null> {
  if (!secret || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || token.indexOf(".", dot + 1) !== -1) return null;
  const payload = base64UrlDecode(token.slice(0, dot));
  if (payload === null) return null;
  const m = /^([0-9a-f-]{36})\.(email|sms)$/i.exec(payload);
  if (!m || !UUID_RE.test(m[1])) return null;
  const expected = toHex(await hmacSha256(new TextEncoder().encode(secret), payload));
  if (!timingSafeEqual(expected, token.slice(dot + 1).toLowerCase())) return null;
  return { userId: m[1].toLowerCase(), channel: m[2].toLowerCase() as Channel };
}

export function emailUnsubscribeUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/unsubscribe?token=${token}`;
}

export function smsUnsubscribeUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/u/${token}`;
}

// ---------------------------------------------------------------------------
// Phone numbers (Termii wants 234XXXXXXXXXX, no plus)
// ---------------------------------------------------------------------------

/**
 * Normalises a Nigerian mobile number to 234XXXXXXXXXX. Accepts +234..., 234...,
 * 0XXXXXXXXXX, XXXXXXXXXX (10 digits starting 7/8/9), with spaces/dashes/dots/
 * brackets, and 00234.... Returns null for anything else (including non-Nigerian
 * numbers: this platform only sends to Nigerian mobiles).
 */
export function normalizeNigerianNumber(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = input.replace(/[\s\-().]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("234")) {
    // already international; a stray trunk zero (2340801...) is tolerated
    if (d.length === 14 && d[3] === "0") d = "234" + d.slice(4);
  } else if (d.startsWith("0") && d.length === 11) {
    d = "234" + d.slice(1);
  } else if (d.length === 10) {
    d = "234" + d;
  } else {
    return null;
  }
  return /^234[789]\d{9}$/.test(d) ? d : null;
}

// ---------------------------------------------------------------------------
// Email rendering: plain text in, escaped HTML out. Admins never supply HTML.
// ---------------------------------------------------------------------------

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Collapses CR/LF (header injection) in a subject line. */
export function sanitizeSubject(subject: string): string {
  return subject.replace(new RegExp("[\r\n\u2028\u2029]+", "g"), " ").trim().slice(0, 150);
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildEmail(args: {
  subject: string;
  body: string;
  unsubscribeUrl?: string;
}): BuiltEmail {
  const bodyHtml = escapeHtml(args.body.replace(/\r\n/g, "\n")).replace(/\n/g, "<br>\n");
  const footerHtml = args.unsubscribeUrl
    ? `<p style="margin:24px 0 0;font-size:12px;color:#6b7280">You are receiving this because you opted in to KiaKia promotions. ` +
      `<a href="${escapeHtml(args.unsubscribeUrl)}">Unsubscribe</a></p>`
    : "";
  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f9fafb;font-family:Arial,Helvetica,sans-serif;color:#111827">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:24px;border-radius:8px;line-height:1.5">` +
    `<div style="font-weight:700;font-size:18px;margin-bottom:16px">KiaKia</div>` +
    `<div>${bodyHtml}</div>${footerHtml}</div></body></html>`;
  const text = args.unsubscribeUrl
    ? `${args.body}\n\n--\nYou are receiving this because you opted in to KiaKia promotions. Unsubscribe: ${args.unsubscribeUrl}`
    : args.body;
  return { subject: sanitizeSubject(args.subject), html, text };
}

export function buildSms(body: string, optOutUrl?: string): string {
  return optOutUrl ? `${body}\nOpt out: ${optOutUrl}` : body;
}

// ---------------------------------------------------------------------------
// Provider configuration + adapters
// ---------------------------------------------------------------------------

export interface MessagingConfig {
  mode: "live" | "fake";
  siteUrl: string;
  unsubscribeSecret: string;
  oneClickUnsubscribe: boolean;
  resendApiKey: string;
  fromEmail: string;
  replyTo: string;
  termiiApiKey: string;
  termiiSenderId: string;
  termiiBaseUrl: string;
  termiiTransactionalChannel: string; // "dnd" (default) or "generic"
}

type EnvGetter = (name: string) => string | undefined;

export function loadConfig(get: EnvGetter): MessagingConfig {
  const mode = (get("MESSAGE_PROVIDER_MODE") ?? "live").toLowerCase() === "fake" ? "fake" : "live";
  return {
    mode,
    siteUrl: (get("SITE_URL") ?? "").replace(/\/+$/, ""),
    unsubscribeSecret: get("MESSAGE_UNSUBSCRIBE_SECRET") ?? "",
    oneClickUnsubscribe: (get("MESSAGE_UNSUBSCRIBE_ONE_CLICK") ?? "true").toLowerCase() !== "false",
    resendApiKey: get("RESEND_API_KEY") ?? "",
    fromEmail: get("MESSAGE_FROM_EMAIL") ?? "",
    replyTo: get("MESSAGE_REPLY_TO") ?? "",
    termiiApiKey: get("TERMII_API_KEY") ?? "",
    termiiSenderId: get("TERMII_SENDER_ID") ?? "",
    termiiBaseUrl: (get("TERMII_BASE_URL") ?? "https://api.ng.termii.com").replace(/\/+$/, ""),
    termiiTransactionalChannel: get("TERMII_TRANSACTIONAL_CHANNEL") === "generic" ? "generic" : "dnd",
  };
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Resend: POST /emails. Idempotency-Key = outbox id, so a retry after a lost response never double-sends. */
export async function sendEmailViaResend(
  cfg: MessagingConfig,
  row: OutboxRow,
  email: BuiltEmail,
  unsubscribeUrl: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<SendResult> {
  if (!cfg.resendApiKey || !cfg.fromEmail) {
    return { ok: false, permanent: false, error: "provider_not_configured: resend" };
  }
  const headers: Record<string, string> = {};
  if (unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
    if (cfg.oneClickUnsubscribe) headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const payload: Record<string, unknown> = {
    from: cfg.fromEmail,
    to: [row.to_address],
    subject: email.subject,
    html: email.html,
    text: email.text,
    tags: [
      { name: "outbox_id", value: row.id },
      { name: "category", value: row.category },
    ],
  };
  if (cfg.replyTo) payload.reply_to = cfg.replyTo;
  if (Object.keys(headers).length > 0) payload.headers = headers;

  let res: Response;
  try {
    res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": row.id,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, permanent: false, error: "resend_network_error" };
  }
  const json = await safeJson(res);
  if (res.ok) {
    const id = typeof json?.id === "string" ? json.id : null;
    return id
      ? { ok: true, providerMessageId: id }
      : { ok: false, permanent: false, error: "resend_missing_id" };
  }
  // Only the machine name of the error: Resend's `message` can echo the address.
  const name = typeof json?.name === "string" ? json.name.slice(0, 60) : "error";
  return { ok: false, permanent: classifyResendStatus(res.status), error: `resend_http_${res.status}:${name}` };
}

/** 4xx validation problems are permanent; auth/rate-limit/conflict/5xx are retried. */
export function classifyResendStatus(status: number): boolean {
  if (status === 400 || status === 404 || status === 422) return true;
  return false; // 401/403 (config), 409, 429, 5xx: transient
}

/**
 * Termii: POST {base}/api/sms/send, JSON body with api_key. channel "generic"
 * (promotional route) or "dnd" (transactional route; delivers to numbers on the
 * DND register, needs an approved sender ID on that route).
 */
export async function sendSmsViaTermii(
  cfg: MessagingConfig,
  row: OutboxRow,
  text: string,
  fetchImpl: FetchLike = fetch,
): Promise<SendResult> {
  const to = normalizeNigerianNumber(row.to_address);
  if (!to) return { ok: false, permanent: true, error: "invalid_phone" };
  if (!cfg.termiiApiKey || !cfg.termiiSenderId) {
    return { ok: false, permanent: false, error: "provider_not_configured: termii" };
  }
  const channel = row.category === "promotional" ? "generic" : cfg.termiiTransactionalChannel;

  let res: Response;
  try {
    res = await fetchImpl(`${cfg.termiiBaseUrl}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        from: cfg.termiiSenderId,
        sms: text,
        type: "plain",
        channel,
        api_key: cfg.termiiApiKey,
      }),
    });
  } catch {
    return { ok: false, permanent: false, error: "termii_network_error" };
  }
  const json = await safeJson(res);
  const messageId = typeof json?.message_id === "string" ? json.message_id
    : typeof json?.message_id_str === "string" ? json.message_id_str : null;
  if (res.ok && messageId) return { ok: true, providerMessageId: messageId };

  const message = typeof json?.message === "string" ? json.message : "";
  // Insufficient balance / account problems resolve when the owner tops up: retry.
  const transient = res.status === 401 || res.status === 403 || res.status === 408 || res.status === 429 ||
    res.status >= 500 || /balance|insufficient|credit/i.test(message) || (res.ok && !messageId);
  return {
    ok: false,
    permanent: !transient,
    error: `termii_http_${res.status}:${message.replace(/[0-9]{8,}/g, "#").slice(0, 80)}`,
  };
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await res.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Fake provider (MESSAGE_PROVIDER_MODE=fake): no network. Deterministic so the
 * whole pipeline is testable: an address containing "bounce" fails permanently,
 * one containing "flaky" fails transiently, everything else succeeds with id
 * fake_<outbox id>.
 */
export function sendViaFake(row: OutboxRow): SendResult {
  const to = (row.to_address ?? "").toLowerCase();
  if (to.includes("bounce")) return { ok: false, permanent: true, error: "fake_permanent_failure" };
  if (to.includes("flaky")) return { ok: false, permanent: false, error: "fake_transient_failure" };
  return { ok: true, providerMessageId: `fake_${row.id}` };
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

/**
 * Svix signature verification as used by Resend webhooks.
 *   signed content = `${svix-id}.${svix-timestamp}.${rawBody}`
 *   key            = base64-decode(secret without its "whsec_" prefix)
 *   svix-signature = space-separated "v1,<base64 HMAC-SHA256>" entries
 * Rejects timestamps further than `toleranceSeconds` from now (replay guard).
 */
export async function verifySvixSignature(args: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  nowMs?: number;
  toleranceSeconds?: number;
}): Promise<boolean> {
  const { secret, id, timestamp, signature, rawBody } = args;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - ts) > (args.toleranceSeconds ?? 300)) return false;

  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  } catch {
    return false;
  }
  const expected = bytesToBase64(await hmacSha256(keyBytes, `${id}.${timestamp}.${rawBody}`));
  let ok = false;
  for (const part of signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version === "v1" && sig && timingSafeEqual(expected, sig)) ok = true; // no early exit
  }
  return ok;
}

export type ProviderEvent = "delivered" | "failed" | "bounced" | "complained";

export interface ParsedResendEvent {
  event: ProviderEvent | null; // null = not interesting (sent, opened, delayed...)
  outboxId: string | null;
  providerMessageId: string | null;
  detail: string | null;
}

/** Maps a Resend webhook payload to our event vocabulary. */
export function parseResendEvent(payload: unknown): ParsedResendEvent {
  const p = (payload ?? {}) as { type?: unknown; data?: Record<string, unknown> };
  const data = (p.data ?? {}) as Record<string, unknown>;
  const type = typeof p.type === "string" ? p.type : "";

  let outboxId: string | null = null;
  const tags = data.tags;
  if (Array.isArray(tags)) {
    for (const t of tags as Array<{ name?: string; value?: string }>) {
      if (t?.name === "outbox_id" && typeof t.value === "string") outboxId = t.value;
    }
  } else if (tags && typeof tags === "object") {
    const v = (tags as Record<string, unknown>).outbox_id;
    if (typeof v === "string") outboxId = v;
  }
  if (outboxId && !UUID_RE.test(outboxId)) outboxId = null;

  const providerMessageId = typeof data.email_id === "string" ? data.email_id : null;
  let event: ProviderEvent | null = null;
  let detail: string | null = null;
  if (type === "email.delivered") {
    event = "delivered";
  } else if (type === "email.bounced") {
    const bounce = (data.bounce ?? {}) as { type?: unknown; subType?: unknown };
    const permanent = typeof bounce.type === "string" ? bounce.type.toLowerCase() === "permanent" : true;
    event = permanent ? "bounced" : "failed";
    detail = `bounce:${typeof bounce.type === "string" ? bounce.type : "unknown"}${
      typeof bounce.subType === "string" ? "/" + bounce.subType : ""
    }`.slice(0, 100);
  } else if (type === "email.complained") {
    event = "complained";
  } else if (type === "email.failed") {
    event = "failed";
    detail = "resend_send_failed";
  }
  return { event, outboxId, providerMessageId, detail };
}

export interface ParsedTermiiEvent {
  event: ProviderEvent | null;
  providerMessageId: string | null;
  detail: string | null;
}

/**
 * Maps a Termii delivery-report payload. ASSUMPTION (verify against a real
 * callback): JSON with message_id and a human-readable status such as
 * "Delivered", "Message Failed", "DND Active on Phone Number", "Rejected".
 */
export function parseTermiiEvent(payload: unknown): ParsedTermiiEvent {
  const p = (payload ?? {}) as Record<string, unknown>;
  const id = typeof p.message_id === "string" ? p.message_id
    : typeof p.id === "string" ? p.id
    : typeof p.message_id_str === "string" ? p.message_id_str : null;
  const status = typeof p.status === "string" ? p.status.toLowerCase() : "";
  let event: ProviderEvent | null = null;
  let detail: string | null = null;
  if (/undeliver|fail|reject|dnd|expired|block|invalid/.test(status)) {
    event = "failed";
    detail = `termii:${status}`.slice(0, 100);
  } else if (/deliver/.test(status)) {
    event = "delivered";
  }
  return { event, providerMessageId: id, detail };
}
