/**
 * Delivery-fee, service-fee, and rider-fee formulas, mirrored in SQL inside
 * `place_order()` (supabase/migrations/0062_remove_free_delivery_threshold.sql,
 * the current definition) and `accept_dispatch_offer()`
 * (supabase/migrations/0044_rider_fee_by_distance.sql) exactly like
 * order-state-machine.ts mirrors transition_order(). Keep all three in sync.
 *
 * kiakia-system-architecture.md defines `service_areas.base_delivery_fee_kobo`
 * and `per_km_fee_kobo` (§9) but never states the exact delivery-fee formula,
 * and `orders.service_fee_kobo` exists with no formula at all. SERVICE_FEE_BPS
 * below is a placeholder rate, not a documented product decision — flagged
 * here and in the SQL, not silently assumed. `rider_base_fee_kobo`/
 * `rider_per_km_fee_kobo` (added in 0044) are the same kind of placeholder —
 * no real rider unit-economics decision exists yet.
 *
 * There used to be a fourth input here, `free_above_kobo` — a per-service-area
 * threshold that zeroed the delivery fee once the subtotal crossed it, while
 * the rider was still paid their full distance-based fee regardless. Removed
 * in 0062: nothing tied the threshold to what a rider fee actually costs for
 * that distance, so a large enough free-delivery order could push the
 * platform's residual share to zero or negative — the latter of which trips
 * verify_delivery_and_release_escrow()'s own safety check and fails the
 * payout outright. See that migration's header for the full reasoning.
 */

import { type Kobo, addKobo, applyBps, koboOf, subtractKobo } from "./money";

/** 2% of subtotal. Placeholder pending a real pricing decision — see file header. */
export const SERVICE_FEE_BPS = 200;

export function computeServiceFee(subtotalKobo: Kobo): Kobo {
  return applyBps(subtotalKobo, SERVICE_FEE_BPS);
}

export interface DeliveryFeeInput {
  readonly subtotalKobo: Kobo;
  readonly baseDeliveryFeeKobo: Kobo;
  readonly perKmFeeKobo: Kobo;
  readonly distanceM: number;
}

/** base + per_km * ceil(distance_km). Always charged in full — see this file's header. */
export function computeDeliveryFee(input: DeliveryFeeInput): Kobo {
  if (input.distanceM < 0 || !Number.isFinite(input.distanceM)) {
    throw new RangeError(`distanceM must be a non-negative finite number, got ${input.distanceM}`);
  }

  const distanceKm = Math.ceil(input.distanceM / 1000);
  return addKobo(input.baseDeliveryFeeKobo, koboOf(input.perKmFeeKobo * distanceKm));
}

export interface PlacementFeesInput {
  readonly subtotalKobo: Kobo;
  readonly baseDeliveryFeeKobo: Kobo;
  readonly perKmFeeKobo: Kobo;
  readonly distanceM: number;
}

export interface PlacementFees {
  readonly deliveryFeeKobo: Kobo;
  readonly serviceFeeKobo: Kobo;
}

/** Convenience wrapper computing both fees `place_order()` needs, together. */
export function computePlacementFees(input: PlacementFeesInput): PlacementFees {
  return {
    deliveryFeeKobo: computeDeliveryFee(input),
    serviceFeeKobo: computeServiceFee(input.subtotalKobo),
  };
}

export interface RiderFeeInput {
  readonly riderBaseFeeKobo: Kobo;
  readonly riderPerKmFeeKobo: Kobo;
  /** Rider's current position -> vendor, at the moment the offer is accepted. */
  readonly pickupDistanceM: number;
  /** Vendor -> customer, i.e. the order's own `distance_m` (§9's existing leg). */
  readonly dropoffDistanceM: number;
}

/**
 * base + per_km * ceil((pickup_leg + dropoff_leg) / 1000) — what the rider
 * actually earns for the order, mirrored in SQL inside
 * `accept_dispatch_offer()` (supabase/migrations/0044_rider_fee_by_distance.sql).
 *
 * Deliberately NOT the same number as `computeDeliveryFee()` above, and
 * still isn't even now that the free-delivery waiver is gone (0062): the
 * customer's delivery fee only ever covers the vendor -> customer leg,
 * while the rider is paid for the FULL trip, pickup leg included — the
 * rider's own commute to the vendor is real cost regardless of what the
 * customer's delivery fee happens to be. See 0044's file header for the
 * original bug this fixed (a free-delivery order used to pay the rider ₦0)
 * and 0062's for why the waiver itself was removed rather than left as a
 * standing risk to the platform's own margin.
 */
export function computeRiderFee(input: RiderFeeInput): Kobo {
  for (const [label, value] of [
    ["pickupDistanceM", input.pickupDistanceM],
    ["dropoffDistanceM", input.dropoffDistanceM],
  ] as const) {
    if (value < 0 || !Number.isFinite(value)) {
      throw new RangeError(`${label} must be a non-negative finite number, got ${value}`);
    }
  }

  const totalDistanceKm = Math.ceil((input.pickupDistanceM + input.dropoffDistanceM) / 1000);
  return addKobo(input.riderBaseFeeKobo, koboOf(input.riderPerKmFeeKobo * totalDistanceKm));
}

export { subtractKobo };
