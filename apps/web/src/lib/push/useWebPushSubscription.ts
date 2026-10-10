// lib/push/useWebPushSubscription.ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { clientEnv } from "@/lib/env.client";

export type WebPushStatus =
  /** No VAPID key configured, or the browser doesn't support Web Push at all (Safari < 16, most in-app browsers). */
  | "unsupported"
  | "loading"
  | "subscribed"
  | "not_subscribed"
  /** The user (or a prior site visit) explicitly denied the permission prompt — subscribe() would just fail silently, so callers should hide the control rather than show a button that can't work. */
  | "denied";

export interface WebPushSubscriptionState {
  status: WebPushStatus;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

/** RFC 8291's applicationServerKey wants a Uint8Array, not the base64url
 * string VAPID key pairs are normally generated/distributed as. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.codePointAt(0) ?? 0));
}

/**
 * Registers public/sw.js and manages this browser's Web Push subscription —
 * the customer/vendor counterpart of the rider app's Expo push registration,
 * for order-status updates (0069_web_push_subscriptions.sql). Deliberately
 * opt-in only: nothing here runs until a caller (NotificationsButton.tsx)
 * actually invokes `subscribe()` from a real user gesture — registering a
 * service worker or requesting Notification permission on page load, before
 * the visitor has asked for either, is exactly the pattern that gets a site
 * auto-blocked from ever prompting again in most browsers.
 */
export function useWebPushSubscription(): WebPushSubscriptionState {
  const [status, setStatus] = useState<WebPushStatus>("loading");

  useEffect(() => {
    let cancelled = false;

    async function checkExisting() {
      if (
        typeof window === "undefined" ||
        !clientEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        if (!cancelled) setStatus("unsupported");
        return;
      }

      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("denied");
        return;
      }

      // Only reads an EXISTING registration/subscription — never registers
      // the service worker itself. A visitor who has never opted in has no
      // registration yet, which is the expected, common case, not an error.
      const registration = await navigator.serviceWorker.getRegistration("/");
      const existing = await registration?.pushManager.getSubscription();
      if (!cancelled) setStatus(existing ? "subscribed" : "not_subscribed");
    }

    void checkExisting();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    if (!clientEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus(permission === "denied" ? "denied" : "not_subscribed");
      return;
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // TS's DOM lib types applicationServerKey as BufferSource specifically
      // over ArrayBuffer, while Uint8Array.from()'s return type is generic
      // over ArrayBufferLike (which also covers SharedArrayBuffer) — a real
      // runtime Uint8Array satisfies the browser API either way, this cast
      // is purely to satisfy that lib-typing mismatch.
      applicationServerKey: urlBase64ToUint8Array(clientEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY) as BufferSource,
    });

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      // A subscription the browser itself couldn't fully populate is
      // useless to the server — never register a partial one.
      await subscription.unsubscribe();
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.rpc("register_web_push_subscription", {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
    });

    if (error) {
      console.error("useWebPushSubscription: register_web_push_subscription failed", error);
      return;
    }

    setStatus("subscribed");
  }, []);

  const unsubscribe = useCallback(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) {
      setStatus("not_subscribed");
      return;
    }

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();

    const supabase = createClient();
    const { error } = await supabase.rpc("unregister_web_push_subscription", { p_endpoint: endpoint });
    if (error) {
      // The browser-side unsubscribe already succeeded — this user will
      // not be pushed to again from THIS browser regardless. A stale
      // server-side row is a cleanup nicety, not a correctness problem the
      // UI needs to block on.
      console.error("useWebPushSubscription: unregister_web_push_subscription failed", error);
    }

    setStatus("not_subscribed");
  }, []);

  return { status, subscribe, unsubscribe };
}
