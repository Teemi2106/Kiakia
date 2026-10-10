// supabase/functions/dispatch-push/index.ts
//
// Sends the actual push notification a rider's device receives for a new
// dispatch offer — the delivery mechanism migration 0053 explicitly
// deferred ("actually SENDING an Expo push notification requires ... a
// Supabase Edge Function triggered off rows in the tables this migration
// creates"). Built now by migration 0062
// (dispatch_offers_notify_rider trigger), which calls this function once
// per newly-inserted dispatch_offers row via pg_net.
//
// TRUST BOUNDARY: unlike monnify-webhook (public, HMAC-verified,
// verify_jwt = false), this function has no override in
// supabase/config.toml, so it keeps the platform default: `verify_jwt =
// true`. Only a caller presenting a valid Supabase JWT can reach it, and
// the only caller that ever does is migration 0062's trigger, which
// authenticates as the service-role key it reads from Vault (see that
// migration's header for the one-time secret setup this depends on). A
// rider's own JWT would also pass verify_jwt, but there is no
// authenticated-reachable path that lets a rider invoke this directly —
// it is not exposed anywhere in the client SDK's surface the way an RPC
// is.
//
// This function trusts its own request body's {order_id, rider_id} without
// re-deriving them from anything — reasonable ONLY because the caller is
// this project's own trigger, not a public webhook. Contrast with
// monnify-webhook, which never trusts its payload's amount/status and
// always re-verifies against Monnify's API directly (§6.3): the threat
// models are different because the callers are.
//
// Never blocks or fails loudly enough to matter to the caller: pg_net
// fire-and-forgets this call (the trigger does not wait for a response),
// so nothing here can slow down or roll back the dispatch that fired it.
// Errors are logged (visible in the function's own logs) and returned with
// a non-2xx status purely for observability.

import { createClient } from "@supabase/supabase-js";
import { buildOfferPushMessages, deadTokensFrom, sendExpoPushMessages } from "./expo.ts";

// Auto-injected into every deployed Edge Function by the platform — not set
// via `supabase secrets set`, same as monnify-webhook's own copy of these
// two.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RequestBody {
  order_id?: string;
  rider_id?: string;
}

Deno.serve(async (req: Request) => {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { order_id, rider_id } = body;
  if (!order_id || !rider_id) {
    return Response.json({ error: "order_id and rider_id are required" }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Two plain selects rather than one embedded query. Deliberate: a
  // postgrest embed's shape (object vs. one-element array) depends on
  // whether the FK relationship is unambiguous to PostgREST's schema
  // cache, which is exactly the kind of thing that silently changes
  // behavior across a schema change elsewhere in this large a project.
  // Two queries are boring and cannot be wrong about their own shape.
  const [{ data: order, error: orderError }, { data: tokenRows, error: tokensError }] =
    await Promise.all([
      supabase.from("orders").select("code, vendor_id").eq("id", order_id).maybeSingle(),
      supabase.from("rider_push_tokens").select("token").eq("rider_id", rider_id),
    ]);

  if (orderError) {
    console.error("dispatch-push: failed to read order", order_id, orderError);
    return Response.json({ error: "order lookup failed" }, { status: 500 });
  }
  if (tokensError) {
    console.error("dispatch-push: failed to read push tokens", rider_id, tokensError);
    return Response.json({ error: "token lookup failed" }, { status: 500 });
  }

  const tokens = (tokenRows ?? []).map((row) => row.token);
  if (tokens.length === 0) {
    // Not an error — most riders in this fan-out will not have granted
    // push permission or completed EAS registration yet. The realtime/
    // polling path in the app is still what actually delivers the offer.
    return Response.json({ ok: true, sent: 0 });
  }

  let vendorName = "a nearby restaurant";
  if (order) {
    const { data: vendor } = await supabase
      .from("vendors")
      .select("name")
      .eq("id", order.vendor_id)
      .maybeSingle();
    if (vendor?.name) vendorName = vendor.name;
  }

  const messages = buildOfferPushMessages({ tokens, vendorName, orderId: order_id });

  try {
    const tickets = await sendExpoPushMessages(messages);

    // Housekeeping, not this invocation's main job: prune tokens Expo has
    // told us are permanently dead, so the "next rider on this phone is
    // not woken" property `unregisterPushToken()` describes also holds for
    // an uninstall Expo detects server-side, not only an in-app sign-out.
    const dead = deadTokensFrom(tokens, tickets);
    if (dead.length > 0) {
      await supabase.from("rider_push_tokens").delete().eq("rider_id", rider_id).in("token", dead);
    }

    return Response.json({ ok: true, sent: tokens.length, dead: dead.length });
  } catch (error) {
    console.error("dispatch-push: Expo send failed", order_id, rider_id, error);
    return Response.json({ error: "push send failed" }, { status: 502 });
  }
});
