"use client";

// mapbox-gl touches `window`/WebGL at import time, so this module is only ever
// reached through the ssr:false dynamic import in FleetMap.tsx.
import { clientEnv } from "@/lib/env.client";
import type { FleetRiderStatus } from "@/lib/fleet/fleet-info";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useMemo, useRef } from "react";
import { Layer, Map, Marker, Source, type LayerProps, type MapRef } from "react-map-gl/mapbox";

export interface MapRider {
  readonly userId: string;
  readonly fullName: string;
  readonly status: FleetRiderStatus;
  readonly lat: number;
  readonly lng: number;
  /** Where a rider on a delivery is heading, rounded to ~100 m. */
  readonly destination: { readonly lat: number; readonly lng: number } | null;
}

export interface MapCell {
  readonly lat: number;
  readonly lng: number;
  readonly orders: number;
}

const heatLayer: LayerProps = {
  id: "fleet-demand-heat",
  type: "heatmap",
  paint: {
    "heatmap-weight": ["interpolate", ["linear"], ["get", "orders"], 2, 0.25, 12, 1],
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 15, 2],
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 14, 15, 60],
    "heatmap-opacity": 0.8,
    "heatmap-color": [
      "interpolate",
      ["linear"],
      ["heatmap-density"],
      0, "rgba(255,220,197,0)",
      0.2, "rgb(255,220,197)",
      0.5, "rgb(255,140,66)",
      0.8, "rgb(221,60,30)",
      1, "rgb(150,15,15)",
    ],
  },
};

const routeLayer: LayerProps = {
  id: "fleet-rider-routes",
  type: "line",
  layout: { "line-cap": "round" },
  paint: { "line-color": "#934b00", "line-width": 2, "line-dasharray": [0.4, 1.8] },
};

const DOT_COLORS: Record<FleetRiderStatus, string> = {
  delivering: "#d97706",
  available: "#16a34a",
  no_signal: "#9ca3af",
  offline: "#9ca3af",
};

export default function FleetMapbox({ cells, riders }: { cells: readonly MapCell[]; riders: readonly MapRider[] }) {
  const mapRef = useRef<MapRef | null>(null);

  const heatData = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: cells.map((cell) => ({
        type: "Feature",
        properties: { orders: cell.orders },
        geometry: { type: "Point", coordinates: [cell.lng, cell.lat] },
      })),
    }),
    [cells],
  );

  const routeData = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: riders
        .filter((rider) => rider.destination)
        .map((rider) => ({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [rider.lng, rider.lat],
              [rider.destination!.lng, rider.destination!.lat],
            ],
          },
        })),
    }),
    [riders],
  );

  const points = useMemo(() => [...cells.map((c) => [c.lng, c.lat]), ...riders.map((r) => [r.lng, r.lat])], [cells, riders]);

  // Frame everything once the data first arrives. Not on every refresh: the page
  // re-reads every 20 s and that would yank the view away from where a manager is looking.
  const framed = useRef(false);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || framed.current || points.length === 0) return;
    framed.current = true;
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 60, maxZoom: 14, duration: 0 },
    );
  }, [points]);

  const first = points[0] ?? [7.4951, 9.0579]; // Abuja, only when there is nothing to frame

  return (
    <Map
      ref={mapRef}
      reuseMaps
      mapboxAccessToken={clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN}
      initialViewState={{ longitude: first[0], latitude: first[1], zoom: 11 }}
      mapStyle="mapbox://styles/mapbox/light-v11"
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
    >
      <Source id="fleet-demand" type="geojson" data={heatData}>
        <Layer {...heatLayer} />
      </Source>
      <Source id="fleet-routes" type="geojson" data={routeData}>
        <Layer {...routeLayer} />
      </Source>
      {riders.map((rider) => (
        <Marker key={rider.userId} longitude={rider.lng} latitude={rider.lat} anchor="center">
          <span title={`${rider.fullName}`} className="flex flex-col items-center">
            <span
              className="size-3.5 rounded-full border-2 border-white shadow"
              style={{ backgroundColor: DOT_COLORS[rider.status] }}
            />
            <span className="mt-0.5 whitespace-nowrap rounded bg-white/90 px-1 text-[10px] font-medium text-ink shadow-sm">
              {rider.fullName.split(" ")[0]}
            </span>
          </span>
        </Marker>
      ))}
    </Map>
  );
}
