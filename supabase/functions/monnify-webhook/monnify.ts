// supabase/functions/monnify-webhook/monnify.ts
//
// A Deno port of apps/web/src/lib/monnify.ts's Monnify API client, kept
// separate from index.ts (which owns the actual `Deno.serve(...)` call) so
// this module has no side effects on import — importing it for a test
// never binds a port. See lib/monnify.ts's own header for the two gotchas
// this mirrors: amounts are in Naira (major unit) not kobo, and the access
// token is cached per-instance (fine for one function invocation
// container, same reasoning as that module's module-level cache).

const MONNIFY_BASE_URL = Deno.env.get("MONNIFY_BASE_URL") ?? "";
const MONNIFY_API_KEY = Deno.env.get("MONNIFY_API_KEY") ?? "";
const MONNIFY_API_SECRET = Deno.env.get("MONNIFY_API_SECRET") ?? "";

interface MonnifyEnvelope<T> {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: T;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  const basicAuth = btoa(`${MONNIFY_API_KEY}:${MONNIFY_API_SECRET}`);
  const response = await fetch(`${MONNIFY_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}` },
  });

  if (!response.ok) {
    throw new Error(`Monnify auth failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as MonnifyEnvelope<{ accessToken: string; expiresIn: number }>;
  if (!body.requestSuccessful) {
    throw new Error(`Monnify auth rejected: ${body.responseMessage}`);
  }

  cachedToken = {
    accessToken: body.responseBody.accessToken,
    expiresAt: Date.now() + (body.responseBody.expiresIn - 60) * 1000,
  };
  return cachedToken.accessToken;
}

async function monnifyFetch<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${MONNIFY_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Monnify request to ${path} failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as MonnifyEnvelope<T>;
  if (!body.requestSuccessful) {
    throw new Error(`Monnify request to ${path} rejected: ${body.responseMessage}`);
  }

  return body.responseBody;
}

export type MonnifyPaymentStatus =
  | "PAID"
  | "OVERPAID"
  | "PARTIALLY_PAID"
  | "PENDING"
  | "ABANDONED"
  | "CANCELLED"
  | "FAILED"
  | "REVERSED"
  | "EXPIRED";

export interface TransactionStatusResult {
  transactionReference: string;
  paymentReference: string;
  amountPaid: number;
  paymentStatus: MonnifyPaymentStatus;
  paidOn: string | null;
  currency: string;
  paymentMethod: string | null;
}

/** §6.3's discipline: never trust the webhook payload alone — re-verify directly. */
export async function verifyTransaction(transactionReference: string): Promise<TransactionStatusResult> {
  return monnifyFetch<TransactionStatusResult>(
    `/api/v2/transactions/${encodeURIComponent(transactionReference)}`,
  );
}

/** Maps Monnify's payment-method vocabulary to ours — mirrors lib/monnify.ts's own map. */
export function mapMonnifyPaymentMethod(paymentMethod: string | null): "card" | "bank_transfer" | "ussd" | null {
  switch (paymentMethod?.toUpperCase()) {
    case "CARD":
      return "card";
    case "ACCOUNT_TRANSFER":
    case "BANK_TRANSFER":
      return "bank_transfer";
    case "USSD":
      return "ussd";
    default:
      return null;
  }
}

/**
 * Verifies the `monnify-signature` header: HMAC-SHA512(rawBody, apiSecret),
 * hex digest, timing-safe compared. Web Crypto, not Node's `crypto` module
 * (lib/monnify.ts's own version) — Deno's edge runtime supports
 * `crypto.subtle` natively and it's the one API guaranteed available
 * across Deno runtimes, including Supabase's. Reads MONNIFY_API_SECRET
 * fresh from the environment on every call (rather than the module-level
 * MONNIFY_API_SECRET above) specifically so tests can set it with
 * `Deno.env.set(...)` right before calling this, with no import-order
 * dependency to get right.
 */
export async function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader) return false;

  const secret = Deno.env.get("MONNIFY_API_SECRET") ?? "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expected.length !== signatureHeader.length) return false;

  // Manual constant-time compare — Deno has no built-in timingSafeEqual.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return diff === 0;
}
