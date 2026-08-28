// supabase/functions/monnify-webhook/index.ts
//
// Monnify's server-to-server payment notification, as a Supabase Edge
// Function rather than the Next.js Route Handler this used to be
// (apps/web/src/app/api/webhooks/monnify/route.ts, now removed) — the whole
// point of moving it is independent uptime: this must stay reachable even
// during a bad Next.js deploy/rollback, which a Route Handler living in the
// same deployment as everything else cannot guarantee.
//
// Public by design (no Supabase session, no apikey/JWT — see
// supabase/config.toml's `verify_jwt = false` for this function) — the
// `monnify-signature` HMAC (verifyWebhookSignature, ./monnify.ts) is the
// only authority here, checked against the *raw* body before anything else
// touches it. Behavior mirrors the old Route Handler exactly (same
// signature/idempotency/trust-boundary discipline, still §6.3: never trust
// the webhook payload's own amount/status, always re-verify against
// Monnify's API directly) — its Vitest suite (deleted along with the
// route) enumerated the exact behavior reproduced here; monnify.test.ts
// covers this function's own pure pieces (signature verification, payment-
// method mapping) the same way lib/monnify.test.ts did.

import { createClient } from "@supabase/supabase-js";
import { mapMonnifyPaymentMethod, verifyTransaction, verifyWebhookSignature } from "./monnify.ts";

// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected into every
// deployed Edge Function by the platform — not set via `supabase secrets
// set`, unlike MONNIFY_API_KEY/MONNIFY_API_SECRET/MONNIFY_BASE_URL (see
// ./monnify.ts), which are.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface MonnifyWebhookPayload {
  eventType?: string;
  eventData?: {
    transactionReference?: string;
    paymentReference?: string;
  };
}

Deno.serve(async (req: Request) => {
  const rawBody = await req.text();
  const signature = req.headers.get("monnify-signature");

  if (!(await verifyWebhookSignature(rawBody, signature))) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: MonnifyWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MonnifyWebhookPayload;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (payload.eventType !== "SUCCESSFUL_TRANSACTION") {
    // Other event types (failed, reversed, ...) have nothing to capture.
    return Response.json({ ok: true });
  }

  const transactionReference = payload.eventData?.transactionReference;
  if (!transactionReference) {
    return Response.json({ error: "missing transactionReference" }, { status: 400 });
  }

  const verified = await verifyTransaction(transactionReference);

  if (verified.paymentStatus !== "PAID" && verified.paymentStatus !== "OVERPAID") {
    return Response.json({ ok: true });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("code", verified.paymentReference)
    .maybeSingle();

  if (!order) {
    console.error(`Monnify webhook: no order found for payment reference ${verified.paymentReference}`);
    return Response.json({ error: "order not found" }, { status: 404 });
  }

  const { error } = await supabase.rpc("capture_payment", {
    p_order_id: order.id,
    p_provider: "monnify",
    p_provider_ref: verified.transactionReference,
    p_amount_kobo: Math.round(verified.amountPaid * 100), // Monnify's amountPaid is in Naira
    p_raw: verified,
    p_idempotency_key: verified.paymentReference,
    p_channel: mapMonnifyPaymentMethod(verified.paymentMethod),
  });

  if (error) {
    console.error("Monnify webhook: capture_payment failed", error);
    return Response.json({ error: "capture failed" }, { status: 500 });
  }

  return Response.json({ ok: true });
});
