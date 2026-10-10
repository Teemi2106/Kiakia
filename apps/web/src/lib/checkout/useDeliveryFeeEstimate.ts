"use client";

import { useEffect, useState } from "react";
import { computeDeliveryFee, haversineDistanceM, koboOf, type LatLng } from "@kiakia/domain";
import { createClient } from "@/lib/supabase/client";

export interface DeliveryFeeEstimate {
  /** Null while loading, or when the address is outside every active service area. */
  readonly feeKobo: number | null;
  readonly loading: boolean;
  /** True once resolved and the destination genuinely falls outside every area. */
  readonly outsideServiceArea: boolean;
}

const IDLE: DeliveryFeeEstimate = { feeKobo: null, loading: false, outsideServiceArea: false };

/**
 * A delivery-fee ESTIMATE for the checkout page, using the same formula and
 * the same distance basis place_order() will actually charge from — see
 * packages/domain/src/delivery.ts's computeDeliveryFee() and
 * 0063_service_area_rates_for_point.sql's own header for why straight-line
 * (haversine) distance is used here rather than a road-following driving
 * route: it is what st_distance on two geography points actually computes
 * server-side, and a driving route is systematically longer, which would
 * overstate the estimate relative to what gets charged.
 *
 * Never authoritative. place_order() re-derives everything server-side
 * regardless of what this hook returned — a stale estimate here can only
 * ever mislead the customer for a moment before checkout, never overcharge
 * or undercharge them.
 *
 * The effect below is keyed on `vendor`/`destination`'s coordinate VALUES,
 * not their object identity — same convention as lib/maps/directions.ts's
 * useDrivingRoute() and MapboxMap.tsx. This used to require the caller to
 * hand in a referentially-stable object (CheckoutForm.tsx memoizing it by
 * lat/lng), which broke in practice: this hook's own `loading: true` update
 * triggers a re-render, and unless the caller's memoization holds exactly
 * across that render too, a fresh `{lat, lng}` literal arrives, the effect
 * restarts, and the in-flight request gets cancelled before it can ever
 * resolve — the delivery fee gets stuck on "Calculating…" forever even
 * though the RPC call itself succeeds. Keying on the primitive values
 * removes the need to trust the caller's memoization at all.
 */
export function useDeliveryFeeEstimate(
  vendor: LatLng | null,
  destination: LatLng | null,
  subtotalKobo: number,
): DeliveryFeeEstimate {
  const [state, setState] = useState<DeliveryFeeEstimate>(IDLE);

  useEffect(() => {
    if (!vendor || !destination) return;

    let cancelled = false;

    // Deferred to the next tick, not called synchronously in the effect
    // body — same reasoning as useLocationHeartbeat.ts's own initial ping:
    // it lets every state update in this hook happen from a callback, never
    // from the effect's own direct execution.
    const kickoff = setTimeout(() => {
      if (cancelled) return;
      setState({ feeKobo: null, loading: true, outsideServiceArea: false });

      const supabase = createClient();
      supabase
        .rpc("find_service_area_for_point", { p_lng: destination.lng, p_lat: destination.lat })
        .then(
          ({ data, error }) => {
            if (cancelled) return;

            const area = Array.isArray(data) ? data[0] : undefined;
            if (error || !area) {
              setState({ feeKobo: null, loading: false, outsideServiceArea: !error });
              return;
            }

            const distanceM = haversineDistanceM(vendor, destination);
            const feeKobo = computeDeliveryFee({
              subtotalKobo: koboOf(subtotalKobo),
              baseDeliveryFeeKobo: koboOf(area.base_delivery_fee_kobo),
              perKmFeeKobo: koboOf(area.per_km_fee_kobo),
              distanceM,
            });
            setState({ feeKobo, loading: false, outsideServiceArea: false });
          },
          () => {
            if (!cancelled) setState({ feeKobo: null, loading: false, outsideServiceArea: false });
          },
        );
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(kickoff);
    };
    // Coordinate values, not object identity — see this function's own doc
    // comment for why that distinction is load-bearing here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor?.lat, vendor?.lng, destination?.lat, destination?.lng, subtotalKobo]);

  if (!vendor || !destination) return IDLE;
  return state;
}
