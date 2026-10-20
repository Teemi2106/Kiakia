import { createHmac } from "node:crypto";
import { cycleEnv } from "./cycle-env";

/**
 * Monnify's signature scheme, exactly as supabase/functions/monnify-webhook/
 * monnify.ts verifies it: HMAC-SHA512 over the RAW request body, keyed with
 * the API secret, hex-encoded, sent as the `monnify-signature` header. The
 * secret here is the throwaway one stack.mjs set on the local Edge Function
 * only.
 */
export function signMonnifyBody(rawBody: string, secret: string = cycleEnv.monnifySecret): string {
  return createHmac("sha512", secret).update(rawBody).digest("hex");
}

export interface WebhookResult {
  readonly status: number;
  readonly body: unknown;
}

/** POSTs a SUCCESSFUL_TRANSACTION event to the locally served Edge Function. */
export async function sendMonnifyWebhook(
  transactionReference: string,
  opts: { signature?: string | null; eventType?: string; secret?: string } = {},
): Promise<WebhookResult> {
  const rawBody = JSON.stringify({
    eventType: opts.eventType ?? "SUCCESSFUL_TRANSACTION",
    // The function deliberately ignores everything in here except the
    // transactionReference: amount/status are re-fetched from Monnify. The
    // lies below prove it - a forged amount in the payload must change nothing.
    eventData: { transactionReference, amountPaid: 1, paymentStatus: "PAID" },
  });
  const signature = opts.signature === undefined ? signMonnifyBody(rawBody, opts.secret) : opts.signature;
  const res = await fetch(cycleEnv.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...(signature ? { "monnify-signature": signature } : {}) },
    body: rawBody,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: res.status, body };
}

/** The test's "customer paid at the bank" lever on the mock Monnify. */
export async function setMockTransaction(input: {
  paymentReference: string;
  paymentStatus?: "PAID" | "OVERPAID" | "PARTIALLY_PAID" | "PENDING" | "FAILED";
  amountPaidNaira?: number;
  paymentMethod?: "CARD" | "ACCOUNT_TRANSFER" | "USSD";
}): Promise<{ transactionReference: string }> {
  const res = await fetch(`${cycleEnv.monnifyMockUrl}/__control/transactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`mock monnify control call failed: ${res.status}`);
  return (await res.json()) as { transactionReference: string };
}

export async function getMockRefunds(): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${cycleEnv.monnifyMockUrl}/__control/refunds`);
  return (await res.json()) as Array<Record<string, unknown>>;
}
