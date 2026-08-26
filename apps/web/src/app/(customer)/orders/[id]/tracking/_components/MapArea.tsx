// app/(customer)/orders/[id]/tracking/_components/MapArea.tsx
"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { Loader2, MapPinOff } from "lucide-react";
import { isTerminalStatus, type OrderStatus } from "@kiakia/domain";
import { clientEnv } from "@/lib/env.client";
import { useOrderTracking } from "./useOrderTracking";

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
  loading: () => <MapMessage icon={<Loader2 className="size-5 animate-spin" />} message="Loading map…" />,
});

interface MapAreaProps {
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
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#F6F3F2] px-6 text-center">
      {icon}
      <span className="font-inter text-sm font-medium text-[#5B403C]">{message}</span>
    </div>
  );
}

/**
 * Renders the live-tracking map: a vendor/pickup marker, a destination
 * marker, and a rider marker that moves as Realtime pings arrive over
 * order_rider_locations (supabase/migrations/0026_rider_self_service.sql).
 * Dispatch is fully built (0019/0023/0026/0028_admin_rider_kyc.sql), so a
 * live rider position is a real, ordinary state here — not a "needs Phase 3"
 * placeholder as this file used to claim.
 *
 * NEXT_PUBLIC_MAPBOX_TOKEN is optional (no Mapbox account has been
 * provisioned yet) — with no token this degrades to a neutral "map
 * unavailable" panel rather than ever attempting to load mapbox-gl. Every
 * other tracking-page surface (timeline, rider card, delivery code) reads
 * from page.tsx's own server-side query and works completely independent of
 * this component.
 */
export function MapArea({ variant = "desktop", orderId, status }: MapAreaProps) {
  const isDesktop = variant === "desktop";

  return (
    <div className={`relative ${isDesktop ? "flex-1" : "h-full w-full"}`}>
      <div className={`h-full w-full bg-[#F6F3F2] ${isDesktop ? "" : "absolute inset-0"}`}>
        {clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN ? (
          <TrackedMap orderId={orderId} fallbackStatus={status} />
        ) : (
          <MapMessage
            icon={<MapPinOff className="size-6 text-[#5B403C]" />}
            message="Live map unavailable"
          />
        )}
      </div>
    </div>
  );
}

function TrackedMap({ orderId, fallbackStatus }: { orderId?: string; fallbackStatus: OrderStatus }) {
  const tracking = useOrderTracking(orderId);

  if (tracking.loading) {
    return <MapMessage icon={<Loader2 className="size-5 animate-spin text-[#5B403C]" />} message="Loading map…" />;
  }

  if (tracking.error) {
    return (
      <MapMessage icon={<MapPinOff className="size-6 text-[#5B403C]" />} message="Couldn't load the live map" />
    );
  }

  const effectiveStatus = tracking.status ?? fallbackStatus;
  const terminal = isTerminalStatus(effectiveStatus);

  return (
    <div className="relative h-full w-full">
      <MapboxMap
        vendor={tracking.vendor}
        destination={tracking.destination}
        // Once an order is terminal, order_rider_locations has already been
        // cleared server-side (0026's trigger) — never render a stale pin.
        rider={terminal ? null : tracking.rider}
      />

      {!terminal && tracking.realtimeStatus === "disconnected" && (
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-[rgba(28,27,27,0.85)] px-3 py-1 font-inter text-xs font-medium text-white shadow-lg">
          Reconnecting live updates…
        </div>
      )}
    </div>
  );
}
