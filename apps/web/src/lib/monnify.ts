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

export type MonnifyRefundStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface RefundResult {
  refundReference: string;
  transactionReference: string;
  refundReason: string;
  customerNote: string;
  refundAmount: number; // Naira, same gotcha as everywhere else in this file
  refundStatus: MonnifyRefundStatus;
  refundType: string;
  createdOn: string;
  completedOn: string | null;
  comment: string | null;
}

export interface InitiateRefundInput {
  transactionReference: string;
  /** Caller's own idempotency anchor — reuse the same string across retries
   * (this app uses "<order.code>-refund") so a retried call can never
   * become a second, separate refund at Monnify's end. */
  refundReference: string;
  refundAmountKobo: number;
  /** Max 64 chars per Monnify's contract — truncated here, not at call sites. */
  refundReason: string;
  /** Shown on the customer's bank credit alert — max 16 chars per Monnify's contract. */
  customerNote: string;
}

/**
 * Initiates an actual refund at Monnify — money leaving the platform's
 * Monnify balance back to the customer, not just a KiaKia-internal ledger
 * entry (that's `_unwind_order_escrow_ledger()`/refund_order_escrow(),
 * which only reverses our own books and cannot reach Monnify's API at all —
 * Postgres has no HTTP client here). Endpoint/request/response shape
 * confirmed against Monnify's own docs (developers.monnify.com/docs/collections/refunds)
 * and a real third-party client's source, not assumed from memory —
 * `refundStatus` is still worth reconfirming against a live sandbox refund
 * before this is trusted in production, same discipline this file's own
 * header applies to the amount-unit gotcha.
 */
export async function initiateRefund(input: InitiateRefundInput): Promise<RefundResult> {
  return monnifyFetch<RefundResult>("/api/v1/refunds/initiate-refund", {
    method: "POST",
    body: JSON.stringify({
      transactionReference: input.transactionReference,
      refundReference: input.refundReference,
      refundAmount: koboToNaira(koboOf(input.refundAmountKobo)),
      refundReason: input.refundReason.slice(0, 64),
      customerNote: input.customerNote.slice(0, 16),
    }),
  });
}

/**
 * Polls a previously-initiated refund's current status by the SAME
 * refundReference initiateRefund() was called with — Monnify's refund
 * completion is asynchronous (PENDING/IN_PROGRESS at initiation time), this
 * is how a caller finds out later whether it actually completed.
 * Not yet called from anywhere in this app (no polling job exists), but
 * kept alongside initiateRefund() since it shares the same client/gotchas
 * and any future retry/reconciliation job will need it.
 */
export async function getRefundStatus(refundReference: string): Promise<RefundResult> {
  return monnifyFetch<RefundResult>(`/api/v1/refunds/${encodeURIComponent(refundReference)}`);
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

// verifyWebhookSignature() used to live here — it moved to
// supabase/functions/monnify-webhook/index.ts (a Web Crypto port, since
// Deno's edge runtime is the only place that HMAC check still runs) when
// the Monnify webhook itself moved from a Next.js Route Handler to a
// Supabase Edge Function, for independent uptime. Nothing in this app
// verifies that signature anymore — the order detail page's fallback
// capture (orders/[id]/page.tsx) re-verifies the transaction itself
// against Monnify's API, which needs no signature at all.
