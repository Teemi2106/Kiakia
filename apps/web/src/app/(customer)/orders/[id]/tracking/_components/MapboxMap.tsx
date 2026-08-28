// app/(customer)/orders/[id]/tracking/_components/MapboxMap.tsx
"use client";

// mapbox-gl touches `window`/WebGL at import time, so this component is
// ONLY ever reached via `dynamic(() => import("./MapboxMap"), { ssr: false })`
// from MapArea.tsx — see that file for why (Next 16 requires the ssr:false
// boundary to live in a Client Component, not the page's Server Component).
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useMemo, useRef } from "react";
import { Map, Marker, Source, Layer, type MapRef, type LayerProps } from "react-map-gl/mapbox";
import { Bike, Home, Store } from "lucide-react";
import { clientEnv } from "@/lib/env.client";
import type { LatLng } from "./useOrderTracking";
import type { TrackingPhase } from "./trackingPhase";
import { useSmoothedLatLng } from "./useSmoothedLatLng";

interface MapboxMapProps {
  vendor: LatLng | null;
  destination: LatLng | null;
  rider: LatLng | null;
  /** Which leg to draw — see trackingPhase.ts. */
  phase: TrackingPhase;
  /** Road-following geometry for the current leg (lib/maps/directions.ts), or
   * null while it is still loading or unavailable. */
  routeGeometry: GeoJSON.LineString | null;
}

/** The live leg: the actual road the order is travelling. */
const routeLineLayer: LayerProps = {
  id: "tracking-route-line",
  type: "line",
  layout: { "line-join": "round", "line-cap": "round" },
  paint: { "line-color": "#b61913", "line-width": 4.5 },
};

/** A soft halo under the route so it stays readable over dark map features. */
const routeCasingLayer: LayerProps = {
  id: "tracking-route-casing",
  type: "line",
  layout: { "line-join": "round", "line-cap": "round" },
  paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 },
};

/**
 * Only drawn when the real route hasn't arrived (or failed) — dashed and
 * clearly distinguished from the solid road route so it is never mistaken
 * for actual driving directions. Same convention as CheckoutMap.tsx.
 */
const fallbackLineLayer: LayerProps = {
  id: "tracking-fallback-line",
  type: "line",
  layout: { "line-join": "round", "line-cap": "round" },
  paint: { "line-color": "#b61913", "line-width": 2.5, "line-dasharray": [0.4, 1.8] },
};

/** Rider -> kitchen, before pickup. Always a straight hint, never a route. */
const approachLineLayer: LayerProps = {
  id: "tracking-approach-line",
  type: "line",
  layout: { "line-join": "round", "line-cap": "round" },
  paint: { "line-color": "#934b00", "line-width": 2, "line-dasharray": [0.4, 2] },
};

function lineFeature(coordinates: GeoJSON.Position[]): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } };
}

export default function MapboxMap({
  vendor,
  destination,
  rider,
  phase,
  routeGeometry,
}: MapboxMapProps) {
  const mapRef = useRef<MapRef | null>(null);

  // Once the rider is carrying the order, the kitchen is behind them and
  // stops being part of the picture — the map is just the rider and you.
  const deliveringToCustomer = phase === "to_customer";
  const showVendor = !deliveringToCustomer && vendor !== null;

  // The leg being drawn: kitchen -> you before pickup, rider -> you after.
  const legOrigin = deliveringToCustomer ? rider : vendor;
  const smoothRider = useSmoothedLatLng(rider);

  const legPoints = useMemo(() => {
    const pts: LatLng[] = [];
    if (legOrigin) pts.push(legOrigin);
    if (destination) pts.push(destination);
    if (!deliveringToCustomer && rider) pts.push(rider);
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- coordinate values, not object identity (a new rider object arrives per ping).
  }, [
    legOrigin?.lat,
    legOrigin?.lng,
    destination?.lat,
    destination?.lng,
    rider?.lat,
    rider?.lng,
    deliveringToCustomer,
  ]);

  const routeGeoJson = useMemo(
    () => (routeGeometry ? lineFeature(routeGeometry.coordinates) : null),
    [routeGeometry],
  );

  const fallbackGeoJson = useMemo(() => {
    if (routeGeoJson || !legOrigin || !destination) return null;
    return lineFeature([
      [legOrigin.lng, legOrigin.lat],
      [destination.lng, destination.lat],
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeGeoJson, legOrigin?.lat, legOrigin?.lng, destination?.lat, destination?.lng]);

  // Pre-pickup, a rider already on their way to the kitchen is worth showing,
  // but the hop they're making isn't the order's journey — a dashed hint, not
  // a routed line, and no Directions request spent on it.
  const approachGeoJson = useMemo(() => {
    if (deliveringToCustomer || !rider || !vendor) return null;
    return lineFeature([
      [rider.lng, rider.lat],
      [vendor.lng, vendor.lat],
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveringToCustomer, rider?.lat, rider?.lng, vendor?.lat, vendor?.lng]);

  const boundsCoords = useMemo<GeoJSON.Position[]>(() => {
    const coords: GeoJSON.Position[] = routeGeometry
      ? [...routeGeometry.coordinates]
      : legPoints.map((p) => [p.lng, p.lat]);
    // A route only covers its own two endpoints; an approaching rider sits
    // outside it and would otherwise be framed off-screen.
    if (!deliveringToCustomer && rider) coords.push([rider.lng, rider.lat]);
    return coords;
  }, [routeGeometry, legPoints, deliveringToCustomer, rider]);

  // Re-frame when the journey itself changes — the leg switches at pickup, a
  // marker appears or disappears, or a new route comes back. Deliberately NOT
  // on every rider ping: that would yank the viewport around several times a
  // minute. Keeping the rider on screen is handled separately below.
  const framingKey = `${phase}:${showVendor}:${destination !== null}:${rider !== null}:${routeGeometry !== null}`;
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || boundsCoords.length === 0) return;

    if (boundsCoords.length === 1) {
      map.easeTo({ center: boundsCoords[0] as [number, number], zoom: 14, duration: 700 });
      return;
    }

    const lngs = boundsCoords.map((c) => c[0]);
    const lats = boundsCoords.map((c) => c[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 72, duration: 800, maxZoom: 16 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the framing identity above, not on raw coordinates.
  }, [framingKey]);

  // Follow the rider only when they would otherwise leave the screen. Panning
  // on every ping fights anyone who has deliberately zoomed or dragged; never
  // panning means the marker quietly walks out of view on a long delivery.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !rider) return;

    const bounds = map.getBounds();
    if (!bounds) return;

    // Only re-frame once the rider is genuinely outside the viewport, not
    // merely near its edge.
    if (bounds.contains([rider.lng, rider.lat])) return;

    if (destination) {
      map.fitBounds(
        [
          [Math.min(rider.lng, destination.lng), Math.min(rider.lat, destination.lat)],
          [Math.max(rider.lng, destination.lng), Math.max(rider.lat, destination.lat)],
        ],
        { padding: 72, duration: 900, maxZoom: 16 },
      );
    } else {
      map.easeTo({ center: [rider.lng, rider.lat], duration: 900 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- coordinate values, not object identity.
  }, [rider?.lat, rider?.lng, destination?.lat, destination?.lng]);

  if (legPoints.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-kk-sand px-6 text-center font-inter text-sm text-kk-cocoa">
        Waiting for location data…
      </div>
    );
  }

  return (
    <Map
      ref={mapRef}
      reuseMaps
      mapboxAccessToken={clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN}
      initialViewState={{ longitude: legPoints[0].lng, latitude: legPoints[0].lat, zoom: 13 }}
      mapStyle="mapbox://styles/mapbox/light-v11"
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
    >
      {routeGeoJson && (
        <Source id="tracking-route" type="geojson" data={routeGeoJson}>
          <Layer {...routeCasingLayer} />
          <Layer {...routeLineLayer} />
        </Source>
      )}

      {fallbackGeoJson && (
        <Source id="tracking-route-fallback" type="geojson" data={fallbackGeoJson}>
          <Layer {...fallbackLineLayer} />
        </Source>
      )}

      {approachGeoJson && (
        <Source id="tracking-approach" type="geojson" data={approachGeoJson}>
          <Layer {...approachLineLayer} />
        </Source>
      )}

      {showVendor && vendor && (
        <Marker longitude={vendor.lng} latitude={vendor.lat} anchor="bottom">
          <MapPin label="Kitchen" tone="neutral">
            <Store className="size-4 text-kk-cocoa" />
          </MapPin>
        </Marker>
      )}

      {destination && (
        <Marker longitude={destination.lng} latitude={destination.lat} anchor="bottom">
          <MapPin label="You" tone="destination">
            <Home className="size-4 text-white" />
          </MapPin>
        </Marker>
      )}

      {smoothRider && (
        <Marker longitude={smoothRider.lng} latitude={smoothRider.lat} anchor="center">
          <span className="relative flex items-center justify-center">
            <span className="absolute size-10 animate-ping rounded-full bg-kk-red/35" />
            <span className="relative flex size-9 items-center justify-center rounded-full border-2 border-white bg-kk-red shadow-[0_8px_18px_-6px_rgba(0,0,0,0.6)]">
              <Bike className="size-4 text-white" />
            </span>
          </span>
        </Marker>
      )}
    </Map>
  );
}

function MapPin({
  children,
  label,
  tone,
}: {
  children: React.ReactNode;
  label: string;
  tone: "neutral" | "destination";
}) {
  return (
    // Label above the pin, pin last: the Marker is anchored "bottom", so
    // whatever sits at the end of this column is what lands on the
    // coordinate.
    <span className="flex flex-col items-center gap-1">
      <span className="whitespace-nowrap rounded-full bg-white/95 px-2 py-0.5 font-inter text-[10px] font-bold uppercase tracking-[0.1em] text-kk-ink shadow-sm">
        {label}
      </span>
      <span
        className={`flex size-9 items-center justify-center rounded-full border-2 shadow-[0_8px_18px_-6px_rgba(0,0,0,0.5)] ${
          tone === "destination" ? "border-white bg-kk-ink" : "border-kk-line bg-white"
        }`}
      >
        {children}
      </span>
    </span>
  );
}
