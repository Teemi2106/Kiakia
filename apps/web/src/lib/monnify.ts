import "server-only";
import { koboOf, koboToNaira } from "@kiakia/domain";
import { serverEnv } from "./env.server";

/**
 * Monnify API client. Verified against Monnify's own docs (Confluence
 * pages + developers.monnify.com) rather than assumed — see the plan doc
 * for the exact sources. Two things worth flagging loudly:
 *
 * 1. Monnify's `amount` field is in **Naira** (major unit, decimals
 *    allowed — "Payment amount in NGN"), unlike Paystack's kobo-only API.
 *    Documentation never states this in so many words; confirm against a
 *    real sandbox transaction before trusting it in production. Every
 *    conversion happens at the one call site below (initializeTransaction),
 *    so if this is wrong, it's a one-line fix.
 * 2. The access token is cached in a module-level variable — fine for a
 *    single Next.js server process, wrong for a multi-instance deployment
 *    without a shared cache (each instance re-logs-in independently, which
 *    is wasteful but not incorrect — Monnify doesn't seem to limit
 *    concurrent tokens per credential).
 */

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

  const basicAuth = Buffer.from(`${serverEnv.MONNIFY_API_KEY}:${serverEnv.MONNIFY_API_SECRET}`).toString("base64");

  const response = await fetch(`${serverEnv.MONNIFY_BASE_URL}/api/v1/auth/login`, {
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

  // Refresh a minute early rather than racing the exact expiry.
  cachedToken = {
    accessToken: body.responseBody.accessToken,
    expiresAt: Date.now() + (body.responseBody.expiresIn - 60) * 1000,
  };
  return cachedToken.accessToken;
}

async function monnifyFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${serverEnv.MONNIFY_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
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

export interface InitializeTransactionInput {
  amountKobo: number;
  paymentReference: string;
  paymentDescription: string;
  customerName: string;
  customerEmail: string;
  redirectUrl: string;
}

export interface InitializeTransactionResult {
  checkoutUrl: string;
  transactionReference: string;
  paymentReference: string;
}

export async function initializeTransaction(input: InitializeTransactionInput): Promise<InitializeTransactionResult> {
  return monnifyFetch<InitializeTransactionResult>("/api/v1/merchant/transactions/init-transaction", {
    method: "POST",
    body: JSON.stringify({
      amount: koboToNaira(koboOf(input.amountKobo)), // see file header, gotcha #1
      currencyCode: "NGN",
      paymentReference: input.paymentReference,
      paymentDescription: input.paymentDescription,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      contractCode: serverEnv.MONNIFY_CONTRACT_CODE,
      redirectUrl: input.redirectUrl,
    }),
  });
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

/**
 * §6.3's discipline, applied to Monnify: never trust a webhook payload
 * alone — re-check with the provider directly. This is what the webhook
 * handler calls after verifying the signature, using the transaction
 * reference from the payload, not the payload's own amount/status fields.
 */
export async function verifyTransaction(transactionReference: string): Promise<TransactionStatusResult> {
  return monnifyFetch<TransactionStatusResult>(
    `/api/v2/transactions/${encodeURIComponent(transactionReference)}`,
  );
}

/**
 * Maps Monnify's payment-method vocabulary to ours
 * (`orders.payment_method` / `payments.channel`: 'card' | 'bank_transfer' |
 * 'ussd'). Monnify's exact strings aren't fully documented publicly — this
 * covers the values their docs and integration guides reference; anything
 * unrecognized maps to null rather than guessing.
 */
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
 * hex digest, timing-safe compared. Must run on the raw request body, not a
 * re-serialized JSON.parse(...) of it — whitespace/key-order differences
 * would break the hash.
 */
export async function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader) return false;

  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const expected = createHmac("sha512", serverEnv.MONNIFY_API_SECRET).update(rawBody).digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signatureHeader, "hex");
  if (expectedBuffer.length !== actualBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
