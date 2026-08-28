// app/(customer)/orders/[id]/tracking/_components/MapArea.tsx
"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { Bike, Loader2, MapPinOff, Store } from "lucide-react";
import { isTerminalStatus, type OrderStatus } from "@kiakia/domain";
import { clientEnv } from "@/lib/env.client";
import { useDrivingRoute } from "@/lib/maps/directions";
import { useOrderTracking } from "./useOrderTracking";
import { trackingPhaseFor } from "./trackingPhase";

// mapbox-gl touches `window` at import time and cannot be server-rendered.
// Next 16's own lazy-loading guide is explicit that `ssr: false` is only
// allowed with `next/dynamic` inside a Client Component (it errors at build
// time from a Server Component) — MapArea already has the "use client"
// directive above, so this is the correct boundary: the page
// (orders/[id]/tracking/page.tsx) stays a Server Component, MapArea is the
// Client Component wrapper, and MapboxMap.tsx is the actual mapbox-gl-touching
// module that only ever loads in the browser.
const MapboxMap = dynamic(() => import("./MapboxMap"), {
  ssr: false,
  loading: () => (
    <MapMessage icon={<Loader2 className="size-5 animate-spin" />} message="Loading map…" />
  ),
});

interface MapAreaProps {
  /** Only positions the route summary chip — the mobile layout's bottom sheet
   * covers the lower half of the map, so it sits at the top there. */
  variant?: "desktop" | "mobile";
  orderId?: string;
  /** The order's status as known by the page's own server-side read at
   * render time — used only as a fallback while the live get_order_tracking()
   * read (below) is still in flight, never as the map's source of truth
   * once that resolves. */
  status: OrderStatus;
}

function MapMessage({ icon, message }: { icon?: ReactNode; message: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-kk-sand px-6 text-center">
      {icon}
      <span className="font-inter text-sm font-medium text-kk-cocoa">{message}</span>
    </div>
  );
}

function formatKm(distanceM: number): string {
  if (distanceM < 950) return `${Math.round(distanceM / 10) * 10} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

function formatDriveMinutes(durationS: number): string {
  const minutes = Math.max(1, Math.round(durationS / 60));
  return `${minutes} min`;
}

/**
 * Renders the live-tracking map. Which leg it draws switches with the order's
 * own status (see trackingPhase.ts): kitchen -> your address while the food is
 * still being made, then rider -> your address the moment it is picked up,
 * redrawn from the rider's live position as they move. The route itself is a
 * real road-following line from Mapbox Directions, not a straight line between
 * pins; positions arrive over Realtime on order_rider_locations
 * (supabase/migrations/0026_rider_self_service.sql).
 *
 * NEXT_PUBLIC_MAPBOX_TOKEN is optional (no Mapbox account has been
 * provisioned yet) — with no token this degrades to a neutral "map
 * unavailable" panel rather than ever attempting to load mapbox-gl. Every
 * other tracking-page surface (timeline, rider card, delivery code) reads
 * from page.tsx's own server-side query and works completely independent of
 * this component.
 */
export function MapArea({ variant = "desktop", orderId, status }: MapAreaProps) {
  return (
    <div className="relative h-full w-full bg-kk-sand">
      {clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN ? (
        <TrackedMap orderId={orderId} fallbackStatus={status} variant={variant} />
      ) : (
        <MapMessage
          icon={<MapPinOff className="size-6 text-kk-cocoa" />}
          message="Live map unavailable"
        />
      )}
    </div>
  );
}

function TrackedMap({
  orderId,
  fallbackStatus,
  variant,
}: {
  orderId?: string;
  fallbackStatus: OrderStatus;
  variant: "desktop" | "mobile";
}) {
  const tracking = useOrderTracking(orderId);

  const effectiveStatus = tracking.status ?? fallbackStatus;
  const terminal = isTerminalStatus(effectiveStatus);
  const phase = trackingPhaseFor(effectiveStatus);

  // Once an order is terminal, order_rider_locations has already been cleared
  // server-side (0026's trigger) — never render a stale pin.
  const rider = terminal ? null : tracking.rider;
  const deliveringToCustomer = phase === "to_customer";
  const legOrigin = deliveringToCustomer ? rider : tracking.vendor;

  // Hooks run before any early return, so this sits above the loading/error
  // branches. Both are null while the initial RPC is in flight, which the
  // hook treats as "nothing to route" — no request is spent.
  //
  // The throttle only matters on the rider leg: a rider pings every few
  // seconds, and re-routing on each one would burn a Directions request to
  // move a line by a few metres. 150m (or 25s, whichever comes first) keeps
  // the drawn road honest without that. The kitchen leg has a fixed origin,
  // so it fetches once and then never again.
  const { route } = useDrivingRoute(legOrigin, tracking.destination, {
    minRefetchMeters: deliveringToCustomer ? 150 : 0,
    maxRouteAgeMs: 25_000,
  });

  if (tracking.loading) {
    return (
      <MapMessage
        icon={<Loader2 className="size-5 animate-spin text-kk-cocoa" />}
        message="Loading map…"
      />
    );
  }

  if (tracking.error) {
    return (
      <MapMessage
        icon={<MapPinOff className="size-6 text-kk-cocoa" />}
        message="Couldn't load the live map"
      />
    );
  }

  return (
    <div className="relative h-full w-full">
      <MapboxMap
        vendor={tracking.vendor}
        destination={tracking.destination}
        rider={rider}
        phase={phase}
        routeGeometry={route?.geometry ?? null}
      />

      {!terminal && route && (
        <div
          className={`pointer-events-none absolute left-4 z-10 flex items-center gap-2.5 rounded-2xl border border-kk-line/70 bg-white/95 px-3.5 py-2.5 shadow-[0_12px_28px_-14px_rgba(28,27,27,0.6)] backdrop-blur ${
            variant === "mobile" ? "top-20" : "bottom-6"
          }`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-kk-red/10 text-kk-red">
            {deliveringToCustomer ? <Bike className="size-4" /> : <Store className="size-4" />}
          </span>
          <span className="min-w-0">
            <span className="block font-inter text-[13px] font-semibold text-kk-ink">
              {deliveringToCustomer
                ? `Rider ${formatKm(route.distanceM)} away`
                : `Kitchen is ${formatKm(route.distanceM)} from you`}
            </span>
            {/* Mapbox's own driving estimate for this road route, labelled as
                exactly that. It is not a delivery ETA: it excludes the queue
                at the kitchen, the hand-off, and every stop in between. */}
            <span className="block font-inter text-[11px] text-kk-cocoa">
              ≈{formatDriveMinutes(route.durationS)} drive
              {deliveringToCustomer ? "" : " · route your order will take"}
            </span>
          </span>
        </div>
      )}

      {!terminal && tracking.realtimeStatus === "disconnected" && (
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-kk-ink-deep/90 px-3 py-1 font-inter text-xs font-medium text-white shadow-lg">
          Reconnecting live updates…
        </div>
      )}
    </div>
  );
}
