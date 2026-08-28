/**
 * Delivery-fee, service-fee, and rider-fee formulas, mirrored in SQL inside
 * `place_order()` (supabase/migrations/0008_place_order.sql) and
 * `accept_dispatch_offer()` (supabase/migrations/0044_rider_fee_by_distance.sql)
 * exactly like order-state-machine.ts mirrors transition_order(). Keep all
 * three in sync.
 *
 * kiakia-system-architecture.md defines `service_areas.base_delivery_fee_kobo`,
 * `per_km_fee_kobo`, and `free_above_kobo` (§9) but never states the exact
 * delivery-fee formula, and `orders.service_fee_kobo` exists with no formula
 * at all. SERVICE_FEE_BPS below is a placeholder rate, not a documented
 * product decision — flagged here and in the SQL, not silently assumed.
 * `rider_base_fee_kobo`/`rider_per_km_fee_kobo` (added in 0044) are the same
 * kind of placeholder — no real rider unit-economics decision exists yet.
 */

import { type Kobo, addKobo, applyBps, koboOf, subtractKobo } from "./money.js";

/** 2% of subtotal. Placeholder pending a real pricing decision — see file header. */
export const SERVICE_FEE_BPS = 200;

export function computeServiceFee(subtotalKobo: Kobo): Kobo {
  return applyBps(subtotalKobo, SERVICE_FEE_BPS);
}

export interface DeliveryFeeInput {
  readonly subtotalKobo: Kobo;
  readonly baseDeliveryFeeKobo: Kobo;
  readonly perKmFeeKobo: Kobo;
  readonly freeAboveKobo: Kobo | null;
  readonly distanceM: number;
}

/**
 * base + per_km * ceil(distance_km), waived entirely once subtotal reaches
 * the service area's free-delivery threshold.
 */
export function computeDeliveryFee(input: DeliveryFeeInput): Kobo {
  if (input.freeAboveKobo !== null && input.subtotalKobo >= input.freeAboveKobo) {
    return koboOf(0);
  }

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
  readonly freeAboveKobo: Kobo | null;
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
 * Deliberately NOT the same number as `computeDeliveryFee()` above: the
 * customer's delivery fee only covers the vendor -> customer leg and is
 * waived above `free_above_kobo`; the rider is paid for the FULL trip
 * (pickup leg included) regardless of any customer-facing waiver — see
 * 0044's file header for why equating the two was a bug (a free-delivery
 * order used to pay the rider ₦0).
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
