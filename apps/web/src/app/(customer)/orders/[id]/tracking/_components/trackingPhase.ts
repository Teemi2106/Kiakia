// app/(customer)/orders/[id]/tracking/_components/trackingPhase.ts
import type { OrderStatus } from "@kiakia/domain";

/**
 * Which leg of the journey the map should be drawing.
 *
 * `to_vendor` — the food is still at (or on its way to) the kitchen. The
 *   route that matters is kitchen -> your address: the trip your order is
 *   about to make. A rider, once assigned, is shown approaching the kitchen.
 *
 * `to_customer` — the rider has the food. The kitchen stops being relevant
 *   the moment it is left behind, so the map switches to just the rider and
 *   you, and the route is redrawn from wherever the rider currently is.
 */
export type TrackingPhase = "to_vendor" | "to_customer";

const CARRYING_THE_ORDER = new Set<OrderStatus>([
  "picked_up",
  "in_transit",
  "arrived",
  // A delivered order keeps the customer-leg framing so the final frame of
  // the map matches the last thing that actually happened, rather than
  // snapping back to the kitchen.
  "delivered",
]);

export function trackingPhaseFor(status: OrderStatus): TrackingPhase {
  return CARRYING_THE_ORDER.has(status) ? "to_customer" : "to_vendor";
}
