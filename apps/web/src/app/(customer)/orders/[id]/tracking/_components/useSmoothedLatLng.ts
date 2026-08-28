// app/(customer)/orders/[id]/tracking/_components/useSmoothedLatLng.ts
"use client";

import { useEffect, useRef, useState } from "react";
import { haversineDistanceM, type LatLng } from "@kiakia/domain";

/** Anything further than this is a correction, not travel — snap, don't glide. */
const SNAP_THRESHOLD_M = 2_000;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Glides a marker between position updates instead of teleporting it.
 *
 * order_rider_locations arrives as discrete pings, so a rider marker bound
 * straight to it jumps every few seconds and reads as a stale screenshot
 * rather than a live map. Interpolating between the last drawn point and the
 * newest one costs nothing and is what makes the map feel alive.
 *
 * The trade-off is honest and bounded: the marker lags the true position by
 * at most `durationMs`. Big jumps (a first fix, a GPS correction, the switch
 * from one leg of the journey to another) snap instead of sliding a rider
 * across town, and anyone who has asked for reduced motion always gets the
 * exact position with no animation at all.
 */
export function useSmoothedLatLng(target: LatLng | null, durationMs = 900): LatLng | null {
  const [displayed, setDisplayed] = useState<LatLng | null>(target);
  const frameRef = useRef(0);
  // The animation reads its start point from a ref rather than `displayed`
  // so a ping landing mid-glide continues from where the marker actually is.
  const currentRef = useRef<LatLng | null>(target);

  useEffect(() => {
    // Every setState below happens inside a requestAnimationFrame callback,
    // never synchronously in this effect's own body — same constraint
    // useOrderTracking.ts satisfies with an async run(), since
    // react-hooks/set-state-in-effect flags a synchronous one. A snap costs
    // one frame, which is exactly when it would have painted anyway.
    const settle = (to: LatLng | null) => {
      frameRef.current = requestAnimationFrame(() => {
        currentRef.current = to;
        setDisplayed(to);
      });
    };

    if (!target) {
      settle(null);
      return () => cancelAnimationFrame(frameRef.current);
    }

    const from = currentRef.current;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (!from || prefersReducedMotion || haversineDistanceM(from, target) > SNAP_THRESHOLD_M) {
      settle(target);
      return () => cancelAnimationFrame(frameRef.current);
    }

    const start = performance.now();
    const startPoint = from;

    const step = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const eased = easeOutCubic(t);
      const next = {
        lat: startPoint.lat + (target.lat - startPoint.lat) * eased,
        lng: startPoint.lng + (target.lng - startPoint.lng) * eased,
      };
      currentRef.current = next;
      setDisplayed(next);
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
    // Keyed on the coordinate values: useOrderTracking hands back a fresh
    // object per ping, so object identity would restart the glide every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.lat, target?.lng, durationMs]);

  return displayed;
}
