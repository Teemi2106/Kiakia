// lib/maps/directions.ts
"use client";

import { useEffect, useRef, useState } from "react";
import { haversineDistanceM, type LatLng } from "@kiakia/domain";
import { clientEnv } from "@/lib/env.client";

export interface DrivingRoute {
  geometry: GeoJSON.LineString;
  distanceM: number;
  durationS: number;
}

interface DrivingRouteState {
  route: DrivingRoute | null;
  /** True only while a fetch for the current origin/destination pair is in flight. */
  loading: boolean;
}

interface DirectionsResponse {
  routes?: {
    geometry: GeoJSON.LineString;
    distance: number;
    duration: number;
  }[];
}

export interface DrivingRouteOptions {
  /**
   * Skip re-fetching until the origin has moved at least this far from the
   * point the current route was drawn from. Meant for a *moving* origin (a
   * rider pinging their position every few seconds): without it, every ping
   * would spend a Directions request to redraw a line that has barely
   * changed. Defaults to 0 — refetch on any coordinate change.
   */
  minRefetchMeters?: number;
  /**
   * Upper bound on how stale a route may get while the origin keeps moving
   * by less than `minRefetchMeters`. Ignored when `minRefetchMeters` is 0.
   */
  maxRouteAgeMs?: number;
}

/**
 * One road-following route between two points, from Mapbox's Directions API.
 * Returns `route: null` (with `loading: false`) if either point is missing,
 * there is no Mapbox token, the request fails, or no route exists between
 * them — callers fall back to a clearly-dashed straight line in that case
 * (see CheckoutMap.tsx / MapboxMap.tsx), never to a fabricated distance.
 *
 * Lives in lib/ rather than beside one route's components because two very
 * different screens need it: checkout draws a fixed vendor -> address route
 * once, and the live tracking map redraws a rider -> address route as the
 * rider moves. The difference between those two is entirely the throttling
 * options below.
 */
export function useDrivingRoute(
  origin: LatLng | null,
  destination: LatLng | null,
  options: DrivingRouteOptions = {},
): DrivingRouteState {
  const { minRefetchMeters = 0, maxRouteAgeMs = 30_000 } = options;

  const [route, setRoute] = useState<DrivingRoute | null>(null);
  const [loading, setLoading] = useState(false);

  // What the currently-drawn route was actually computed from. Compared
  // against each new origin to decide whether the line on screen is still
  // close enough to the truth to leave alone.
  const drawnFrom = useRef<{ origin: LatLng; destination: LatLng; at: number } | null>(null);

  useEffect(() => {
    // Every setState call below lives inside the async `run()` function,
    // never directly in this synchronous effect body — matching
    // useOrderTracking.ts's own effect shape, since
    // react-hooks/set-state-in-effect flags a setState call made
    // synchronously in an effect's own body (including on an early return).
    const controller = new AbortController();

    async function run() {
      if (!origin || !destination || !clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN) {
        drawnFrom.current = null;
        setRoute(null);
        setLoading(false);
        return;
      }

      if (!shouldRefetch(drawnFrom.current, origin, destination, minRefetchMeters, maxRouteAgeMs)) {
        return;
      }

      setLoading(true);

      const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN}`;

      try {
        const res = await fetch(url, { signal: controller.signal });
        const data = res.ok ? ((await res.json()) as DirectionsResponse) : null;
        if (controller.signal.aborted) return;

        const best = data?.routes?.[0];
        if (best) {
          drawnFrom.current = { origin, destination, at: Date.now() };
          setRoute({ geometry: best.geometry, distanceM: best.distance, durationS: best.duration });
        } else {
          drawnFrom.current = null;
          setRoute(null);
        }
      } catch {
        if (!controller.signal.aborted) {
          // Leave `drawnFrom` alone: a failed request shouldn't make the next
          // ping look like a fresh pair and hammer the API on every retry.
          setRoute(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void run();

    return () => controller.abort();
    // origin/destination are plain {lat,lng} objects recreated on most
    // renders (AddressSection.tsx builds one inline; useOrderTracking pushes
    // a new object per rider ping) — keying on their coordinate values, not
    // object identity, is what actually prevents a refetch loop here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    origin?.lat,
    origin?.lng,
    destination?.lat,
    destination?.lng,
    minRefetchMeters,
    maxRouteAgeMs,
  ]);

  return { route, loading };
}

function shouldRefetch(
  drawn: { origin: LatLng; destination: LatLng; at: number } | null,
  origin: LatLng,
  destination: LatLng,
  minRefetchMeters: number,
  maxRouteAgeMs: number,
): boolean {
  if (!drawn) return true;

  // A different destination is a different journey — always redraw.
  if (drawn.destination.lat !== destination.lat || drawn.destination.lng !== destination.lng) {
    return true;
  }

  if (minRefetchMeters <= 0) {
    return drawn.origin.lat !== origin.lat || drawn.origin.lng !== origin.lng;
  }

  if (haversineDistanceM(drawn.origin, origin) >= minRefetchMeters) return true;

  // Crawling in traffic still counts as movement worth re-routing for
  // eventually, so age is a backstop on the distance test.
  return Date.now() - drawn.at >= maxRouteAgeMs;
}
