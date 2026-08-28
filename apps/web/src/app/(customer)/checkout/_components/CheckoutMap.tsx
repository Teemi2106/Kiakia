// app/(customer)/checkout/_components/CheckoutMap.tsx
"use client";

// mapbox-gl touches `window`/WebGL at import time, so this component is
// ONLY ever reached via `dynamic(() => import("./CheckoutMap"), { ssr: false })`
// from CheckoutMapArea.tsx — same pattern as (customer)/orders/[id]/tracking's
// MapboxMap.tsx + MapArea.tsx and (vendor)/dashboard/settings's
// DeliveryLocationMap.tsx: Next 16 requires the ssr:false boundary to live in
// a Client Component, not a Server Component.
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useMemo, useRef } from "react";
import { Map, Marker, Source, Layer, type MapRef } from "react-map-gl/mapbox";
import type { LayerProps } from "react-map-gl/mapbox";
import { Home, Store } from "lucide-react";
import { clientEnv } from "@/lib/env.client";
import type { LatLng } from "@kiakia/domain";

interface CheckoutMapProps {
  vendor: LatLng | null;
  destination: LatLng | null;
  /** A real road-following route from lib/maps/directions.ts (Mapbox Directions), or
   * null while it's still loading / unavailable — see the fallback below. */
  routeGeometry: GeoJSON.LineString | null;
}

const routeLineLayer: LayerProps = {
  id: "checkout-route-line",
  type: "line",
  layout: { "line-join": "round", "line-cap": "round" },
  paint: {
    "line-color": "#B61913",
    "line-width": 4,
  },
};

// Only drawn when routeGeometry hasn't arrived (or failed) — a dashed
// straight line clearly distinguished from the real, solid route so it's
// never mistaken for actual driving directions.
const fallbackLineLayer: LayerProps = {
  id: "checkout-fallback-line",
  type: "line",
  layout: { "line-join": "round", "line-cap": "round" },
  paint: {
    "line-color": "#5B403C",
    "line-width": 2,
    "line-dasharray": [0.2, 1.6],
  },
};

export default function CheckoutMap({ vendor, destination, routeGeometry }: CheckoutMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const hasVendor = vendor !== null;
  const hasDestination = destination !== null;

  const points = useMemo(() => {
    const pts: LatLng[] = [];
    if (vendor) pts.push(vendor);
    if (destination) pts.push(destination);
    return pts;
  }, [vendor, destination]);

  const routeGeoJson = useMemo<GeoJSON.Feature<GeoJSON.LineString> | null>(() => {
    if (routeGeometry) return { type: "Feature", properties: {}, geometry: routeGeometry };
    return null;
  }, [routeGeometry]);

  const fallbackGeoJson = useMemo<GeoJSON.Feature<GeoJSON.LineString> | null>(() => {
    if (routeGeoJson || !vendor || !destination) return null;
    return {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [vendor.lng, vendor.lat],
          [destination.lng, destination.lat],
        ],
      },
    };
  }, [routeGeoJson, vendor, destination]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || points.length === 0) return;

    if (points.length === 1) {
      map.easeTo({ center: [points[0].lng, points[0].lat], zoom: 14, duration: 600 });
      return;
    }

    // Fit to the actual route's coordinates when we have one — a driving
    // route often bows out well past the straight line between the two
    // pins, so bounding just [vendor, destination] can clip it off-screen.
    const boundsCoords: GeoJSON.Position[] = routeGeometry
      ? routeGeometry.coordinates
      : points.map((p) => [p.lng, p.lat]);
    const lngs = boundsCoords.map((c) => c[0]);
    const lats = boundsCoords.map((c) => c[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 56, duration: 600, maxZoom: 15 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on marker presence + the route arriving, not raw point/geometry identity.
  }, [hasVendor, hasDestination, routeGeometry]);

  if (points.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#F6F3F2] text-center font-inter text-sm text-[#5B403C]">
        Set a delivery address to see the map
      </div>
    );
  }

  return (
    <Map
      ref={mapRef}
      reuseMaps
      mapboxAccessToken={clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN}
      initialViewState={{ longitude: points[0].lng, latitude: points[0].lat, zoom: 13 }}
      mapStyle="mapbox://styles/mapbox/streets-v12"
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
    >
      {routeGeoJson && (
        <Source id="checkout-route" type="geojson" data={routeGeoJson}>
          <Layer {...routeLineLayer} />
        </Source>
      )}

      {fallbackGeoJson && (
        <Source id="checkout-route-fallback" type="geojson" data={fallbackGeoJson}>
          <Layer {...fallbackLineLayer} />
        </Source>
      )}

      {vendor && (
        <Marker longitude={vendor.lng} latitude={vendor.lat} anchor="bottom">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#E4BEB8] bg-[#FCF9F8] shadow-lg">
            <Store className="size-4 text-[#5B403C]" />
          </div>
        </Marker>
      )}

      {destination && (
        <Marker longitude={destination.lng} latitude={destination.lat} anchor="bottom">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#B61913] bg-[#B61913] shadow-lg">
            <Home className="size-4 text-white" />
          </div>
        </Marker>
      )}
    </Map>
  );
}
