// app/(customer)/checkout/_components/CheckoutMapArea.tsx
"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { Loader2, MapPinOff } from "lucide-react";
import { haversineDistanceM, type LatLng } from "@kiakia/domain";
import { clientEnv } from "@/lib/env.client";
import { useDrivingRoute } from "@/lib/maps/directions";

// mapbox-gl touches `window` at import time and cannot be server-rendered.
// See CheckoutMap.tsx's header comment for why this boundary has to live
// here, in a Client Component, rather than in a Server Component.
const CheckoutMap = dynamic(() => import("./CheckoutMap"), {
  ssr: false,
  loading: () => <MapMessage icon={<Loader2 className="size-5 animate-spin" />} message="Loading map…" />,
});

interface CheckoutMapAreaProps {
  vendor: LatLng | null;
  destination: LatLng | null;
}

function MapMessage({ icon, message }: { icon?: ReactNode; message: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#F6F3F2] px-6 text-center">
      {icon}
      <span className="font-inter text-sm font-medium text-[#5B403C]">{message}</span>
    </div>
  );
}

function formatDistance(distanceM: number): string {
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

function formatDuration(durationS: number): string {
  const mins = Math.max(1, Math.round(durationS / 60));
  return `${mins} min`;
}

/**
 * The checkout page's vendor-to-customer map: a store pin, a delivery pin,
 * and the road-following route between them (lib/maps/directions.ts, backed by
 * Mapbox's Directions API — re-fetched live any time the address/coords
 * change). NEXT_PUBLIC_MAPBOX_TOKEN is optional (no Mapbox account
 * provisioned yet — see env.client.ts) — with no token this degrades to a
 * neutral "map unavailable" panel rather than ever attempting to load
 * mapbox-gl, same as the order-tracking MapArea.tsx.
 */
export function CheckoutMapArea({ vendor, destination }: CheckoutMapAreaProps) {
  const { route, loading: routeLoading } = useDrivingRoute(vendor, destination);
  const straightLineM = vendor && destination ? haversineDistanceM(vendor, destination) : null;

  return (
    <div className="space-y-2">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-[#E4BEB8]">
        {clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN ? (
          <CheckoutMap vendor={vendor} destination={destination} routeGeometry={route?.geometry ?? null} />
        ) : (
          <MapMessage
            icon={<MapPinOff className="size-6 text-[#5B403C]" />}
            message="Map unavailable"
          />
        )}
      </div>
      {route ? (
        <p className="font-inter text-xs text-[#5B403C]">
          <span className="font-semibold text-[#1C1B1B]">{formatDistance(route.distanceM)}</span>{" "}
          · {formatDuration(route.durationS)} drive from the restaurant to this address
        </p>
      ) : (
        routeLoading &&
        straightLineM !== null && (
          <p className="font-inter text-xs text-[#5B403C]">Finding the route…</p>
        )
      )}
      {!route && !routeLoading && straightLineM !== null && (
        <p className="font-inter text-xs text-[#5B403C]">
          <span className="font-semibold text-[#1C1B1B]">{formatDistance(straightLineM)}</span>{" "}
          (straight-line) from the restaurant to this address
        </p>
      )}
    </div>
  );
}
