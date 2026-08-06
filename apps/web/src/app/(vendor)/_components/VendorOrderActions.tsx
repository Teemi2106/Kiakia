import { advanceOrderAction } from "@/app/actions/orders";
import type { OrderStatus } from "@kiakia/db";
import { Button } from "@kiakia/ui";

/**
 * The vendor's next available action(s) for a given order status, per the
 * state machine (§10) — only the edges a *vendor* actor can trigger.
 * `ready_for_pickup` onward needs a rider (dispatch, Phase 3), so there's
 * nothing for the vendor to do there but wait.
 */
export function VendorOrderActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  if (status === "placed") {
    return (
      <div className="flex gap-2">
        <form action={advanceOrderAction.bind(null, orderId, "accepted")} className="flex-1">
          <Button type="submit" className="w-full">
            Accept Order
          </Button>
        </form>
        <form action={advanceOrderAction.bind(null, orderId, "rejected_by_vendor")} className="flex-1">
          <Button type="submit" variant="secondary" className="w-full">
            Reject
          </Button>
        </form>
      </div>
    );
  }

  if (status === "accepted") {
    return (
      <form action={advanceOrderAction.bind(null, orderId, "preparing")}>
        <Button type="submit" className="w-full">
          Start Preparing
        </Button>
      </form>
    );
  }

  if (status === "preparing") {
    return (
      <form action={advanceOrderAction.bind(null, orderId, "ready_for_pickup")}>
        <Button type="submit" className="w-full">
          Mark Ready for Pickup
        </Button>
      </form>
    );
  }

  if (status === "ready_for_pickup") {
    return <p className="text-center text-xs text-ink-muted">Waiting for a rider to be assigned…</p>;
  }

  return null;
}
