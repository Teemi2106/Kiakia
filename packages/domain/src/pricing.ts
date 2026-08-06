/**
 * Pure order-total and settlement-split math, transcribed from
 * kiakia-system-architecture.md §9 ("The ledger invariant") and §12
 * ("Server Action computes the total server-side"). This is the function a
 * Server Action calls to arrive at a total that the client cannot influence
 * — the client-supplied total is never trusted (§12, point 1).
 *
 * This module intentionally does NOT touch promo codes, distance-based fee
 * calculation, or the database — those need live menu/service-area data and
 * belong in the Server Action that calls this, per §5's rule that
 * price computation runs server-side but stays out of the client bundle.
 */

import { type Kobo, addKobo, applyBps, koboOf, subtractKobo } from "./money";

export interface OrderTotalsInput {
  readonly subtotalKobo: Kobo;
  readonly deliveryFeeKobo: Kobo;
  readonly serviceFeeKobo: Kobo;
  readonly discountKobo: Kobo;
}

export interface OrderTotals extends OrderTotalsInput {
  readonly totalKobo: Kobo;
}

/**
 * Computes the customer-facing total. Discount is capped at
 * subtotal + deliveryFee + serviceFee so a misapplied promo can never make
 * the total negative.
 */
export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const gross = addKobo(input.subtotalKobo, input.deliveryFeeKobo, input.serviceFeeKobo);
  const cappedDiscount = koboOf(Math.min(input.discountKobo, gross));
  const totalKobo = subtractKobo(gross, cappedDiscount);

  return { ...input, discountKobo: cappedDiscount, totalKobo };
}

export interface SettlementSplit {
  /** What the vendor is credited once escrow releases. */
  readonly vendorKobo: Kobo;
  /** What the rider is credited for the delivery. */
  readonly riderKobo: Kobo;
  /** Platform commission + service fee. */
  readonly platformKobo: Kobo;
}

/**
 * Splits a completed order into the three ledger legs released from escrow
 * on delivery (§9's worked example, §12's escrow-release flow). Commission
 * is taken from the food subtotal only — delivery fee passes through to the
 * rider in full, and the service fee is pure platform revenue.
 *
 * Reproduces §9's worked example exactly:
 *   ₦12,500 order (₦10,000 food / ₦2,000 delivery / ₦500 service, 15% commission)
 *   -> vendor ₦8,500, rider ₦2,000, platform ₦2,000.
 */
export function computeSettlementSplit(
  subtotalKobo: Kobo,
  deliveryFeeKobo: Kobo,
  serviceFeeKobo: Kobo,
  commissionBps: number,
): SettlementSplit {
  const commissionKobo = applyBps(subtotalKobo, commissionBps);
  const vendorKobo = subtractKobo(subtotalKobo, commissionKobo);
  const platformKobo = addKobo(commissionKobo, serviceFeeKobo);

  return { vendorKobo, riderKobo: deliveryFeeKobo, platformKobo };
}
