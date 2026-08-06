/**
 * The order lifecycle, transcribed from kiakia-system-architecture.md §10.
 *
 * This table is the *specification*. `supabase/migrations/0006_transition_order.sql`
 * implements the same table inside a `SECURITY DEFINER` plpgsql function so the
 * database can enforce it atomically (locks the row, validates the transition,
 * writes `order_events`, all in one transaction — see §10 point 1-4). The two
 * must never drift: if you change one, change the other in the same commit,
 * and add a pgTAP assertion in supabase/tests that exercises the new edge.
 *
 * Edges beyond the literal diagram in §10 are called out below with the prose
 * rule that justifies them — nothing here is invented past what the doc states.
 */

export const ORDER_STATUSES = [
  "draft",
  "placed",
  "accepted",
  "rejected_by_vendor",
  "preparing",
  "ready_for_pickup",
  "rider_assigned",
  "picked_up",
  "in_transit",
  "arrived",
  "delivered",
  "failed_delivery",
  "cancelled_by_customer",
  "cancelled_by_platform",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "delivered",
  "rejected_by_vendor",
  "failed_delivery",
  "cancelled_by_customer",
  "cancelled_by_platform",
]);

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  draft: ["placed"],

  // §10: vendor SLA timer (180s) on `placed -> accepted`; on expiry the order
  // is auto-cancelled with a full refund, which is a platform action, not a
  // customer or vendor one -> cancelled_by_platform.
  placed: ["accepted", "rejected_by_vendor", "cancelled_by_customer", "cancelled_by_platform"],

  // §10: "Cancellation after preparing compensates the vendor from the
  // customer charge" — stated generally, not narrowed to one status, and
  // §22 gives admin ops a stalled-order cancel-and-refund path at any point
  // the order is stuck between acceptance and pickup. Applied uniformly to
  // accepted..in_transit below.
  accepted: ["preparing", "cancelled_by_platform"],
  preparing: ["ready_for_pickup", "cancelled_by_platform"],
  ready_for_pickup: ["rider_assigned", "cancelled_by_platform"],
  rider_assigned: ["picked_up", "cancelled_by_platform"],
  picked_up: ["in_transit", "cancelled_by_platform"],
  in_transit: ["arrived", "cancelled_by_platform"],

  // §10 diagram: arrived branches three ways.
  arrived: ["delivered", "failed_delivery", "cancelled_by_platform"],

  // Terminal states.
  rejected_by_vendor: [],
  delivered: [],
  failed_delivery: [],
  cancelled_by_customer: [],
  cancelled_by_platform: [],
};

export class InvalidOrderTransitionError extends Error {
  constructor(
    public readonly from: OrderStatus,
    public readonly to: OrderStatus,
  ) {
    super(`Illegal order transition: ${from} -> ${to}`);
    this.name = "InvalidOrderTransitionError";
  }
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Throws InvalidOrderTransitionError if the transition is not allowed. */
export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) {
    throw new InvalidOrderTransitionError(from, to);
  }
}
