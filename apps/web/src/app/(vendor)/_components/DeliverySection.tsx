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
 * on the way) and, while the food is still being made, the "Need more time?"
 * control. Renders nothing when the server has no dispatch state to show.
 */
export function DeliverySection({
  orderId,
  status,
  deliveryBy,
  dispatch,
  deliveryFeeKobo,
}: {
  orderId: string;
  status: string;
  deliveryBy?: "rider" | "vendor";
  dispatch?: VendorDispatchState | null;
  deliveryFeeKobo: number;
}) {
  if (deliveryBy === "vendor") {
    return <SelfDeliveryPanel orderId={orderId} status={status} deliveryFeeKobo={deliveryFeeKobo} />;
  }
  // Stays mounted while any dispatch state exists: after "Look further away" the
  // state moves on to "offers pending" and the banner then shows its result line.
  if (!dispatch) return null;
  return (
    <div className="flex flex-col gap-3 empty:hidden">
      <NoRiderBanner orderId={orderId} status={status} dispatch={dispatch} />
      {canAdjustPrep({ status, deliveryBy }) && <PrepEstimateControl orderId={orderId} expectedReadyAt={dispatch.expectedReadyAt} />}
    </div>
  );
}
