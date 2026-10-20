"use client";

import { useCallback, useOptimistic, useState, useTransition } from "react";
import { advanceOrderAction } from "@/app/actions/orders";
import { ActionToast } from "@/app/_components/ActionToast";
import type { OrderStatus } from "@kiakia/db";
import { Button } from "@kiakia/ui";

/**
 * The vendor's next available action(s) for a given order status, per the
 * state machine (§10) — only the edges a *vendor* actor can trigger.
 * `ready_for_pickup` onward needs a rider (dispatch, Phase 3), so there's
 * nothing for the vendor to do there but wait.
 *
 * A click moves the panel to the next step immediately and runs the Server
 * Action (transition_order(), which is the real authorization and state-machine
 * check) behind it. If the action fails the panel returns to where it was and a
 * toast says so; on success the action's revalidation delivers the fresh page.
 */
export function VendorOrderActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dismiss = useCallback(() => setError(null), []);
  const [shownStatus, setShownStatus] = useOptimistic<OrderStatus, OrderStatus>(status, (_current, next) => next);

  function advance(next: OrderStatus) {
    setError(null);
    startTransition(async () => {
      setShownStatus(next);
      try {
        await advanceOrderAction(orderId, next);
      } catch {
        setError("Couldn't update that order. It has been put back as it was.");
      }
    });
  }

  let body: React.ReactNode = null;

  if (shownStatus === "placed") {
    body = (
      <div className="flex gap-2">
        <Button type="button" className="w-full flex-1" disabled={isPending} onClick={() => advance("accepted")}>
          Accept Order
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full flex-1"
          disabled={isPending}
          onClick={() => advance("rejected_by_vendor")}
        >
          Reject
        </Button>
      </div>
    );
  } else if (shownStatus === "accepted") {
    body = (
      <Button type="button" className="w-full" disabled={isPending} onClick={() => advance("preparing")}>
        Start Preparing
      </Button>
    );
  } else if (shownStatus === "preparing") {
    body = (
      <Button type="button" className="w-full" disabled={isPending} onClick={() => advance("ready_for_pickup")}>
        Mark Ready for Pickup
      </Button>
    );
  } else if (shownStatus === "ready_for_pickup") {
    body = <p className="text-center text-xs text-ink-muted">Waiting for a rider to be assigned…</p>;
  }

  return (
    <>
      {body}
      <ActionToast message={error} onDismiss={dismiss} />
    </>
  );
}
