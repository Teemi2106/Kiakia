// app/(customer)/orders/[id]/tracking/_components/statusCopy.ts
import type { OrderStatus } from "@kiakia/domain";

const CANCELLED_OR_FAILED = new Set<OrderStatus>([
  "rejected_by_vendor",
  "failed_delivery",
  "cancelled_by_customer",
  "cancelled_by_platform",
]);

/**
 * Headline copy for the tracking page, derived only from the order's real
 * status column. No ETA/"arriving in N min" is shown — computing one needs
 * rider location + dispatch, which is Phase 3 and not built yet (see
 * supabase/migrations/0002_identity.sql, 0011_delivery_code.sql).
 */
export function trackingHeadline(status: OrderStatus): string {
  switch (status) {
    case "draft":
      return "Order not placed yet";
    case "placed":
      return "Order confirmed";
    case "accepted":
      return "Vendor accepted your order";
    case "preparing":
      return "Preparing your order";
    case "ready_for_pickup":
      return "Ready for pickup";
    case "rider_assigned":
      return "Rider assigned";
    case "picked_up":
      return "Order picked up";
    case "in_transit":
      return "Rider is on the way";
    case "arrived":
      return "Rider has arrived";
    case "delivered":
      return "Order delivered";
    case "rejected_by_vendor":
      return "Order rejected";
    case "failed_delivery":
      return "Delivery failed";
    case "cancelled_by_customer":
    case "cancelled_by_platform":
      return "Order cancelled";
    default:
      return "Order status";
  }
}

export function isTrackingTerminal(status: OrderStatus): boolean {
  return CANCELLED_OR_FAILED.has(status);
}
