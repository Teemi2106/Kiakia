"use client";

import { canAdjustPrep } from "@/lib/vendor/prep-estimate";
import type { VendorDispatchState } from "@/lib/vendor/self-delivery";
import { NoRiderBanner } from "./NoRiderBanner";
import { PrepEstimateControl } from "./PrepEstimateControl";
import { SelfDeliveryPanel } from "./SelfDeliveryPanel";

/**
 * Who delivers this order, from the server's state: the vendor's own delivery
 * steps once they chose to deliver, otherwise how the rider search stands (the
 * "no rider near you" choice, the one-at-a-time search, a later start, or a rider
 * on the way) and, while the food is still being made, the prep-time control.
 * Self-delivery orders do not need a dispatch row to set or show their ETA.
 */
export function DeliverySection({
  orderId,
  status,
  deliveryBy,
  dispatch,
  expectedReadyAt,
  deliveryFeeKobo,
}: {
  orderId: string;
  status: string;
  deliveryBy?: "rider" | "vendor";
  dispatch?: VendorDispatchState | null;
  expectedReadyAt?: string | null;
  deliveryFeeKobo: number;
}) {
  const prepControl = canAdjustPrep({ status, deliveryBy }) ? (
    <PrepEstimateControl orderId={orderId} expectedReadyAt={expectedReadyAt ?? dispatch?.expectedReadyAt ?? null} />
  ) : null;

  if (deliveryBy === "vendor") {
    return (
      <div className="flex flex-col gap-3">
        {prepControl}
        <SelfDeliveryPanel orderId={orderId} status={status} deliveryFeeKobo={deliveryFeeKobo} />
      </div>
    );
  }
  // Stays mounted while any dispatch state exists: after "Look further away" the
  // state moves on to "offers pending" and the banner then shows its result line.
  if (!dispatch && !prepControl) return null;
  return (
    <div className="flex flex-col gap-3 empty:hidden">
      {dispatch && <NoRiderBanner orderId={orderId} status={status} dispatch={dispatch} />}
      {prepControl}
    </div>
  );
}
