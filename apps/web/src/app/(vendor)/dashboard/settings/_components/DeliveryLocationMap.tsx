// app/(vendor)/dashboard/settings/_components/DeliveryLocationMap.tsx
"use client";

// mapbox-gl touches `window`/WebGL at import time, so this component is
// ONLY ever reached via `dynamic(() => import("./DeliveryLocationMap"), { ssr:
// false })` from DeliveryZone.tsx — same reasoning/pattern as
// (customer)/orders/[id]/tracking/_components/MapboxMap.tsx + MapArea.tsx:
// Next 16 requires the ssr:false boundary to live in a Client Component, not
// a Server Component, and mapbox-gl can't be evaluated during SSR at all.
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import { Map, Marker, type MapRef } from "react-map-gl/mapbox";
import type { MapMouseEvent, MarkerDragEvent } from "react-map-gl/mapbox";
import { MapPin } from "lucide-react";
import { clientEnv } from "@/lib/env.client";

export interface LatLng {
  lat: number;
  lng: number;
}

// Lagos, Nigeria — a reasonable default center when the vendor hasn't set a
// location yet, not an implied real position.
export const DEFAULT_MAP_CENTER: LatLng = { lat: 6.5244, lng: 3.3792 };

interface DeliveryLocationMapProps {
  position: LatLng | null;
  onPositionChange: (position: LatLng) => void;
  /**
   * Bump this (e.g. ++counter) to make the map fly to `position` — used by
   * the "Use my current location" button in DeliveryZone.tsx. A plain
   * `position` prop change doesn't do this on its own: dragging/clicking the
   * pin already keeps it in view since the vendor is looking at the map
   * when they do it, so re-centering on every position change would fight
   * the vendor's own pan/zoom. Same reasoning as MapboxMap.tsx's
   * presence-keyed (not coordinate-keyed) re-fit effect.
   */
  flyToRequestId: number;
}

export default function DeliveryLocationMap({ position, onPositionChange, flyToRequestId }: DeliveryLocationMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const center = position ?? DEFAULT_MAP_CENTER;

  useEffect(() => {
    if (flyToRequestId === 0) return; // 0 = mount, nothing requested yet
    const map = mapRef.current?.getMap();
    if (!map || !position) return;
    map.flyTo({ center: [position.lng, position.lat], zoom: 15, duration: 800 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed only on the request id, not `position` (see prop comment above)
  }, [flyToRequestId]);

  function handleMapClick(event: MapMouseEvent) {
    onPositionChange({ lat: event.lngLat.lat, lng: event.lngLat.lng });
  }

  function handleMarkerDragEnd(event: MarkerDragEvent) {
    onPositionChange({ lat: event.lngLat.lat, lng: event.lngLat.lng });
  }

  return (
    <Map
      ref={mapRef}
      reuseMaps
      mapboxAccessToken={clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN}
      initialViewState={{ longitude: center.lng, latitude: center.lat, zoom: position ? 14 : 11 }}
      mapStyle="mapbox://styles/mapbox/streets-v12"
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
      onClick={handleMapClick}
    >
      {position && (
        <Marker
          longitude={position.lng}
          latitude={position.lat}
          anchor="bottom"
          draggable
          onDragEnd={handleMarkerDragEnd}
        >
          <div className="flex h-10 w-10 -translate-y-1 cursor-grab items-center justify-center rounded-full border-2 border-white bg-[#B61913] shadow-lg active:cursor-grabbing">
            <MapPin className="size-5 text-white" />
          </div>
        </Marker>
      )}
    </Map>
  );
}
