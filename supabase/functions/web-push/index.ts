// supabase/functions/web-push/index.ts
//
// Sends the actual browser push notification a customer or vendor staff
// member receives for an order-status update — the delivery mechanism
// 0069_web_push_subscriptions.sql's own header describes and explicitly
// defers to this function. Called once per newly-inserted `notifications`
// row (0038/0049) via pg_net, by that migration's
// notifications_notify_web_push trigger.
//
// TRUST BOUNDARY: same posture as dispatch-push — no verify_jwt override in
// supabase/config.toml, so it keeps the platform default (true). The only
// caller is 0069's trigger, authenticating with the service-role key it
// reads from Vault. This function trusts its own request body's
// {notification_id} without re-deriving it from anything, reasonable only
// because the caller is this project's own trigger, not a public webhook —
// same reasoning as dispatch-push's own header.
//
// Never blocks or fails loudly enough to matter to the caller: pg_net
// fire-and-forgets this call, so nothing here can slow down or roll back
// the notifications insert (or the order transition several layers above
// it) that fired this.

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

// Auto-injected into every deployed Edge Function by the platform — not set
// via `supabase secrets set`, same as dispatch-push/monnify-webhook's own
// copies of these two.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// This function's OWN secrets — set once via `supabase secrets set`, same
// as Monnify's MONNIFY_API_KEY/MONNIFY_API_SECRET (see monnify-webhook's
// own header). VAPID_PUBLIC_KEY must match NEXT_PUBLIC_VAPID_PUBLIC_KEY in
// apps/web's environment exactly — it is what the browser signs its
// PushManager.subscribe() call against, and a mismatch between the two
// makes every subscription this function tries to use invalid.
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@kiakia.app";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

interface RequestBody {
  notification_id?: string;
}

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  order_id: string | null;
  customer_id: string | null;
  vendor_id: string | null;
}

interface SubscriptionRow {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

// The hosts real browsers hand out push endpoints on: FCM (Chrome, Edge,
// Android), Mozilla autopush (Firefox), WNS (Windows), Apple Web Push (Safari).
// Same list as the check in register_web_push_subscription().
const PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);

function isTrustedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || (url.port !== "" && url.port !== "443")) {
    return false;
  }
  return PUSH_HOSTS.has(url.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
}

Deno.serve(async (req: Request) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    // Not configured yet — same silent-skip posture the calling trigger
    // itself already takes when its own Vault secrets are missing. Logged
    // for observability, never a 5xx that would look like a real failure.
    console.warn("web-push: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not set, skipping");
    return Response.json({ ok: true, sent: 0, reason: "vapid_not_configured" });
  }

  let payload: RequestBody;
  try {
    payload = (await req.json()) as RequestBody;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { notification_id } = payload;
  if (!notification_id) {
    return Response.json({ error: "notification_id is required" }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: notification, error: notificationError } = await supabase
    .from("notifications")
    .select("id, title, body, order_id, customer_id, vendor_id")
    .eq("id", notification_id)
    .maybeSingle<NotificationRow>();

  if (notificationError) {
    console.error("web-push: failed to read notification", notification_id, notificationError);
    return Response.json({ error: "notification lookup failed" }, { status: 500 });
  }
  if (!notification) {
    return Response.json({ error: "notification not found" }, { status: 404 });
  }

  // A notifications row belongs to exactly one audience (0049's own
  // constraint) — resolve it to the actual user id(s) that audience means.
  // A customer_id notification has exactly one recipient; a vendor_id
  // notification may have several (every staff member of that vendor).
  const audience: "customer" | "vendor" = notification.customer_id ? "customer" : "vendor";

  let userIds: string[];
  if (notification.customer_id) {
    userIds = [notification.customer_id];
  } else if (notification.vendor_id) {
    const { data: staffRows, error: staffError } = await supabase
      .from("vendor_staff")
      .select("user_id")
      .eq("vendor_id", notification.vendor_id);
    if (staffError) {
      console.error("web-push: failed to read vendor_staff", notification.vendor_id, staffError);
      return Response.json({ error: "vendor staff lookup failed" }, { status: 500 });
    }
    userIds = (staffRows ?? []).map((row) => row.user_id);
  } else {
    // Should be unreachable given 0049's notifications_one_audience check
    // constraint, but this function trusts nothing about its own inputs.
    return Response.json({ ok: true, sent: 0, reason: "no_audience" });
  }

  if (userIds.length === 0) {
    return Response.json({ ok: true, sent: 0 });
  }

  const { data: subscriptionRows, error: subscriptionError } = await supabase
    .from("web_push_subscriptions")
    .select("user_id, endpoint, p256dh, auth_key")
    .in("user_id", userIds);

  if (subscriptionError) {
    console.error("web-push: failed to read subscriptions", userIds, subscriptionError);
    return Response.json({ error: "subscription lookup failed" }, { status: 500 });
  }

  const subscriptions = (subscriptionRows ?? []) as SubscriptionRow[];
  if (subscriptions.length === 0) {
    // Not an error — most users in this fan-out will not have granted
    // browser push permission yet. The in-app bell (NotificationsButton.tsx)
    // is still what actually delivers the notification.
    return Response.json({ ok: true, sent: 0 });
  }

  const notificationPayload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    orderId: notification.order_id,
    // The service worker (public/sw.js) can't reliably tell whether the
    // person who receives this tap is viewing KiaKia as a customer or as
    // vendor staff — sending the audience is what lets it route a tap to
    // /orders/[id] vs /dashboard/orders/[id] correctly either way.
    audience,
  });

  let sent = 0;
  const staleEndpoints: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      // Defence in depth for register_web_push_subscription()'s own endpoint
      // allowlist (0077): a row that predates it, or is written by any other
      // path, must still never make this function request an address the
      // caller chose. Untrusted rows are dropped, not retried.
      if (!isTrustedPushEndpoint(sub.endpoint)) {
        staleEndpoints.push(sub.endpoint);
        return;
      }

      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          notificationPayload,
        );
        sent += 1;
      } catch (error) {
        // 404/410 mean the browser or push service has permanently
        // invalidated this subscription (uninstalled, permission revoked,
        // endpoint rotated past what it will ever accept again) — prune it,
        // same housekeeping dispatch-push does for dead Expo tokens. Any
        // other status is a transient failure, left alone for the next
        // notification to retry against.
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          staleEndpoints.push(sub.endpoint);
        } else {
          console.error("web-push: send failed", sub.endpoint, error);
        }
      }
    }),
  );

  if (staleEndpoints.length > 0) {
    await supabase.from("web_push_subscriptions").delete().in("endpoint", staleEndpoints);
  }

  return Response.json({ ok: true, sent, pruned: staleEndpoints.length });
});
