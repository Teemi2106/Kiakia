"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { clientEnv } from "@/lib/env.client";

export type WebPushStatus =
  | "unsupported"
  | "loading"
  | "subscribed"
  | "not_subscribed"
  | "denied";

export interface WebPushSubscriptionState {
  status: WebPushStatus;
  error: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

const PUSH_STATUS_EVENT = "kiakia:web-push-status";

async function registerSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("The browser returned an incomplete notification subscription.");
  }

  const { error } = await createClient().rpc("register_web_push_subscription", {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
  });
  if (error) throw error;
}

function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.codePointAt(0) ?? 0));
}

/** Manages the signed-in user's push subscription on this browser. */
export function useWebPushSubscription(enabled = true): WebPushSubscriptionState {
  const [status, setStatus] = useState<WebPushStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const updateStatus = useCallback((next: WebPushStatus) => {
    setStatus(next);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<WebPushStatus>(PUSH_STATUS_EVENT, { detail: next }));
    }
  }, []);

  useEffect(() => {
    const onStatusChange = (event: Event) => {
      const next = (event as CustomEvent<WebPushStatus>).detail;
      if (next) setStatus(next);
    };
    window.addEventListener(PUSH_STATUS_EVENT, onStatusChange);
    return () => window.removeEventListener(PUSH_STATUS_EVENT, onStatusChange);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkExisting() {
      if (!enabled) {
        setError(null);
        setStatus("not_subscribed");
        return;
      }

      if (
        typeof window === "undefined" ||
        !clientEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
        !("Notification" in window) ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        if (!cancelled) updateStatus("unsupported");
        return;
      }

      if (Notification.permission === "denied") {
        if (!cancelled) updateStatus("denied");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const existing = await registration?.pushManager.getSubscription();
        if (existing) await registerSubscription(existing);
        if (!cancelled) {
          setError(null);
          updateStatus(existing ? "subscribed" : "not_subscribed");
        }
      } catch (cause) {
        console.error("useWebPushSubscription: could not read the browser subscription", cause);
        if (!cancelled) {
          updateStatus("not_subscribed");
          setError("Couldn’t connect this device to your account. Try turning alerts on again.");
        }
      }
    }

    void checkExisting();
    return () => {
      cancelled = true;
    };
  }, [enabled, updateStatus]);

  const subscribe = useCallback(async () => {
    setError(null);
    if (!clientEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      updateStatus("unsupported");
      setError("Order alerts aren’t configured on this app yet.");
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        updateStatus(permission === "denied" ? "denied" : "not_subscribed");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(clientEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY) as BufferSource,
        }));
      await registerSubscription(subscription);

      updateStatus("subscribed");
    } catch (cause) {
      console.error("useWebPushSubscription: subscribe failed", cause);
      updateStatus("not_subscribed");
      setError("Couldn’t turn on alerts. Check your browser permission and try again.");
    }
  }, [updateStatus]);

  const unsubscribe = useCallback(async () => {
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) {
        updateStatus("not_subscribed");
        return;
      }

      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      const supabase = createClient();
      const { error: unregisterError } = await supabase.rpc("unregister_web_push_subscription", {
        p_endpoint: endpoint,
      });
      if (unregisterError) {
        console.error("useWebPushSubscription: unregister failed", unregisterError);
      }

      updateStatus("not_subscribed");
    } catch (cause) {
      console.error("useWebPushSubscription: unsubscribe failed", cause);
      setError("Couldn’t update this device’s alert settings. Please try again.");
    }
  }, [updateStatus]);

  return { status, error, subscribe, unsubscribe };
}
