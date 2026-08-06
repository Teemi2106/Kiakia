import type { Json } from "@kiakia/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapMonnifyPaymentMethod, verifyTransaction, verifyWebhookSignature } from "@/lib/monnify";
import { NextResponse } from "next/server";

/**
 * Monnify's server-to-server payment notification. Public by design (no
 * session, no cookies) — the `monnify-signature` HMAC is the only
 * authority here, checked against the *raw* body before anything else
 * touches it. Route Handlers, not Server Actions, because this is called
 * by Monnify's servers, not our own UI (§5's table: "Paystack webhook —
 * Edge Function — must stay up independently of the Next.js deploy"; this
 * project runs it as a Next.js Route Handler instead, since there's no
 * separate Edge Function deployment in this build — same idempotency and
 * signature-verification discipline either way).
 */

interface MonnifyWebhookPayload {
  eventType?: string;
  eventData?: {
    transactionReference?: string;
    paymentReference?: string;
  };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("monnify-signature");

  if (!(await verifyWebhookSignature(rawBody, signature))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: MonnifyWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MonnifyWebhookPayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (payload.eventType !== "SUCCESSFUL_TRANSACTION") {
    // Other event types (failed, reversed, ...) have nothing to capture.
    return NextResponse.json({ ok: true });
  }

  const transactionReference = payload.eventData?.transactionReference;
  if (!transactionReference) {
    return NextResponse.json({ error: "missing transactionReference" }, { status: 400 });
  }

  // §6.3's discipline: never trust the webhook payload's own amount/status
  // — re-verify directly against Monnify's API before capturing anything.
  const verified = await verifyTransaction(transactionReference);

  if (verified.paymentStatus !== "PAID" && verified.paymentStatus !== "OVERPAID") {
    return NextResponse.json({ ok: true });
  }

  const supabase = createAdminClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("code", verified.paymentReference)
    .maybeSingle();

  if (!order) {
    console.error(`Monnify webhook: no order found for payment reference ${verified.paymentReference}`);
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  const { error } = await supabase.rpc("capture_payment", {
    p_order_id: order.id,
    p_provider: "monnify",
    p_provider_ref: verified.transactionReference,
    p_amount_kobo: Math.round(verified.amountPaid * 100), // Monnify's amountPaid is in Naira — see lib/monnify.ts header
    p_raw: verified as unknown as Json, // plain string/number/null fields — see TransactionStatusResult
    p_idempotency_key: verified.paymentReference,
    p_channel: mapMonnifyPaymentMethod(verified.paymentMethod),
  });

  if (error) {
    console.error("Monnify webhook: capture_payment failed", error);
    return NextResponse.json({ error: "capture failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
