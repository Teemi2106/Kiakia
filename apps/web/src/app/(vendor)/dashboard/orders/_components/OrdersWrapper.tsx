// app/(vendor)/orders/_components/OrdersWrapper.tsx
"use client";

import { useCallback, useOptimistic, useState, useTransition } from "react";
import type { OrderStatus } from "@kiakia/db";
import { advanceOrderAction } from "@/app/actions/orders";
import { ActionToast } from "@/app/_components/ActionToast";
import { OrdersDesktop } from "./OrdersDesktop";
import { OrdersMobile } from "./OrdersMobile";
import type { Order } from "./types";

interface OrdersWrapperProps {
  orders: Order[];
}

/** Statuses after which an order leaves this page's active list. */
const LEAVES_ACTIVE_LIST = new Set(["rejected_by_vendor"]);

export function OrdersWrapper({ orders }: OrdersWrapperProps) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dismiss = useCallback(() => setError(null), []);

  // The click shows its result at once; the Server Action (which re-checks vendor
  // staff membership and validates the transition itself, via transition_order())
  // runs behind it. useOptimistic reverts to the server's truth when the
  // transition ends, so a failed action rolls the order back on its own and the
  // toast says why. The action's revalidatePath already delivers the fresh list
  // in the same response, so there is no follow-up router.refresh().
  const [optimisticOrders, applyStatus] = useOptimistic(orders, (current, change: { id: string; status: string }) =>
    LEAVES_ACTIVE_LIST.has(change.status)
      ? current.filter((order) => order.id !== change.id)
      : current.map((order) => (order.id === change.id ? { ...order, status: change.status } : order)),
  );

  const handleStatusChange = (orderId: string, status: string) => {
    setError(null);
    startTransition(async () => {
      applyStatus({ id: orderId, status });
      try {
        await advanceOrderAction(orderId, status as OrderStatus);
      } catch {
        setError("Couldn't update that order. It has been put back as it was.");
      }
    });
  };

  return (
    <>
      <div className="hidden lg:block">
        <OrdersDesktop orders={optimisticOrders} onStatusChange={handleStatusChange} />
      </div>
      <div className="lg:hidden">
        <OrdersMobile orders={optimisticOrders} onStatusChange={handleStatusChange} />
      </div>
      <ActionToast message={error} onDismiss={dismiss} />
    </>
  );
}
