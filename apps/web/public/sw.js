// public/sw.js
//
// Minimal Web Push service worker — this app has no offline/caching
// strategy to speak of, so this file's only job is the two events push
// notifications need: receiving one, and routing a tap on it. Registered
// by lib/push/useWebPushSubscription.ts, scope "/", only after a customer
// or vendor staff member explicitly opts in (NotificationsButton.tsx) —
// never registered unconditionally on every page load.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  const { title, body, orderId, audience } = payload;
  if (!title) return;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body ?? "",
      icon: "/assets/logo-mark.png",
      badge: "/assets/logo-mark.png",
      // Collapses a burst of updates on the same order into one visible
      // notification instead of stacking a new one per status change —
      // renotify still alerts the user, it just replaces the prior one
      // rather than piling up alongside it.
      tag: orderId ? `order-${orderId}` : undefined,
      renotify: Boolean(orderId),
      data: { orderId: orderId ?? null, audience: audience ?? "customer" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const orderId = event.notification.data?.orderId;
  const audience = event.notification.data?.audience ?? "customer";
  // The web app's two route groups keep separate order-detail paths for
  // the same order id — /orders/[id] (customer) vs /dashboard/orders/[id]
  // (vendor staff). The push payload's own `audience` (set by the web-push
  // Edge Function from which side of notifications a row belonged to) is
  // what a service worker can't otherwise infer.
  const ordersBasePath = audience === "vendor" ? "/dashboard/orders" : "/orders";
  const targetPath = orderId ? `${ordersBasePath}/${orderId}` : ordersBasePath;

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      // Reuse an already-open KiaKia tab rather than opening a new one, same
      // instinct as the rider app's own notification-tap handler
      // (subscribeToOfferNotificationTaps).
      for (const client of clientsList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(targetPath);
          return;
        }
      }

      await self.clients.openWindow(targetPath);
    })(),
  );
});
