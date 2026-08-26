// app/(customer)/orders/[id]/tracking/_components/MapboxMap.tsx
"use client";

// mapbox-gl touches `window`/WebGL at import time, so this component is
// ONLY ever reached via `dynamic(() => import("./MapboxMap"), { ssr: false })`
// from MapArea.tsx — see that file for why (Next 16 requires the ssr:false
// boundary to live in a Client Component, not the page's Server Component).
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useMemo, useRef } from "react";
import { Map, Marker, type MapRef } from "react-map-gl/mapbox";
import { Bike, Home, Store } from "lucide-react";
import { clientEnv } from "@/lib/env.client";
import type { LatLng } from "./useOrderTracking";

interface MapboxMapProps {
  vendor: LatLng | null;
  destination: LatLng | null;
  rider: LatLng | null;
}

export default function MapboxMap({ vendor, destination, rider }: MapboxMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const hasVendor = vendor !== null;
  const hasDestination = destination !== null;
  const hasRider = rider !== null;

  const points = useMemo(() => {
    const pts: LatLng[] = [];
    if (vendor) pts.push(vendor);
    if (destination) pts.push(destination);
    if (rider) pts.push(rider);
    return pts;
  }, [vendor, destination, rider]);

  // Re-fit the viewport whenever the SET of visible markers changes (a
  // marker appears/disappears) — not on every rider ping, which would
  // otherwise re-center/re-zoom the map on top of the customer several
  // times a minute while a rider is en route.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || points.length === 0) return;

    if (points.length === 1) {
      map.easeTo({ center: [points[0].lng, points[0].lat], zoom: 14, duration: 600 });
      return;
    }

    const lngs = points.map((p) => p.lng);
    const lats = points.map((p) => p.lat);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 72, duration: 600, maxZoom: 16 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on marker presence (booleans), not raw coordinates/`points` (see comment above).
  }, [hasVendor, hasDestination, hasRider]);

  if (points.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#F6F3F2] text-center font-inter text-sm text-[#5B403C]">
        Waiting for location data…
      </div>
    );
  }

  return (
    <Map
      ref={mapRef}
      reuseMaps
      mapboxAccessToken={clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN}
      initialViewState={{ longitude: points[0].lng, latitude: points[0].lat, zoom: 13 }}
      mapStyle="mapbox://styles/mapbox/light-v11"
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
    >
      {vendor && (
        <Marker longitude={vendor.lng} latitude={vendor.lat} anchor="bottom">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#E4BEB8] bg-[#FCF9F8] shadow-lg">
            <Store className="size-4 text-[#5B403C]" />
          </div>
        </Marker>
      )}

      {destination && (
        <Marker longitude={destination.lng} latitude={destination.lat} anchor="bottom">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#E4BEB8] bg-[#FCF9F8] shadow-lg">
            <Home className="size-4 text-[#5B403C]" />
          </div>
        </Marker>
      )}

      {rider && (
        <Marker longitude={rider.lng} latitude={rider.lat} anchor="center">
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 animate-ping rounded-full bg-[#B61913] opacity-40" />
            <div className="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#FCF9F8] bg-[#B61913] shadow-lg">
              <Bike className="size-4 text-white" />
            </div>
          </div>
        </Marker>
      )}
    </Map>
  );
}
