/**
 * Delivery-fee and service-fee formulas, mirrored in SQL inside
 * `place_order()` (supabase/migrations/0008_place_order.sql) exactly like
 * order-state-machine.ts mirrors transition_order(). Keep both in sync.
 *
 * kiakia-system-architecture.md defines `service_areas.base_delivery_fee_kobo`,
 * `per_km_fee_kobo`, and `free_above_kobo` (§9) but never states the exact
 * delivery-fee formula, and `orders.service_fee_kobo` exists with no formula
 * at all. SERVICE_FEE_BPS below is a placeholder rate, not a documented
 * product decision — flagged here and in the SQL, not silently assumed.
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

export { subtractKobo };
