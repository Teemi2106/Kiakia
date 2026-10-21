// supabase/functions/message-webhooks/index.ts
//
// Provider callbacks for the messaging pipeline (migrations 0094-0096):
//   POST .../message-webhooks/resend   Resend (Svix-signed) email events
//   POST .../message-webhooks/termii   Termii SMS delivery reports
//
// Public by design (verify_jwt = false in supabase/config.toml): the signature
// / shared token is the only authority, checked before the body is parsed.
//   resend  Svix: svix-id / svix-timestamp / svix-signature headers verified
//           against RESEND_WEBHOOK_SECRET over the RAW body, 5-minute tolerance.
//   termii  shared token, `?token=` query parameter or `x-webhook-token` header,
//           compared in constant time to TERMII_WEBHOOK_TOKEN. (Termii may also
//           offer its own signature; this shared-token scheme is what we control.)
//
// All state changes go through message_apply_provider_event() (idempotent state
// guards), which also withdraws marketing_email on a hard bounce or spam
// complaint. A receipt for a message we cannot find answers 404 for Resend when
// the event carries our outbox_id tag (it raced the worker; Resend retries) and
// 200 otherwise (not ours / nothing to retry).

import { createClient } from "@supabase/supabase-js";
import {
  parseResendEvent,
  parseTermiiEvent,
  timingSafeEqual,
  verifySvixSignature,
} from "../_shared/messaging.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, "").split("/").pop();
  const rawBody = await req.text();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (route === "resend") {
    const ok = await verifySvixSignature({
      secret: Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "",
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
      rawBody,
    });
    if (!ok) return Response.json({ error: "invalid signature" }, { status: 401 });

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: "invalid JSON" }, { status: 400 });
    }
    const evt = parseResendEvent(payload);
    if (!evt.event) return Response.json({ ok: true, ignored: true });

    const { data, error } = await supabase.rpc("message_apply_provider_event", {
      p_provider: "resend",
      p_provider_message_id: evt.providerMessageId,
      p_outbox_id: evt.outboxId,
      p_event: evt.event,
      p_detail: evt.detail,
    });
    if (error) {
      console.error("message-webhooks: resend event failed", error.code);
      return Response.json({ error: "processing failed" }, { status: 500 });
    }
    if (data === "not_found" && evt.outboxId) {
      return Response.json({ ok: false, status: "not_found" }, { status: 404 });
    }
    return Response.json({ ok: true, status: data });
  }

  if (route === "termii") {
    const expected = Deno.env.get("TERMII_WEBHOOK_TOKEN") ?? "";
    const presented = url.searchParams.get("token") ?? req.headers.get("x-webhook-token") ?? "";
    if (!expected || !timingSafeEqual(presented, expected)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: "invalid JSON" }, { status: 400 });
    }
    // Termii may batch; handle one object or an array.
    const items = Array.isArray(payload) ? payload : [payload];
    let applied = 0;
    for (const item of items) {
      const evt = parseTermiiEvent(item);
      if (!evt.event || !evt.providerMessageId) continue;
      const { data, error } = await supabase.rpc("message_apply_provider_event", {
        p_provider: "termii",
        p_provider_message_id: evt.providerMessageId,
        p_outbox_id: null,
        p_event: evt.event,
        p_detail: evt.detail,
      });
      if (error) {
        console.error("message-webhooks: termii event failed", error.code);
        return Response.json({ error: "processing failed" }, { status: 500 });
      }
      if (data === "applied") applied += 1;
    }
    return Response.json({ ok: true, applied });
  }

  return Response.json({ error: "not found" }, { status: 404 });
});
