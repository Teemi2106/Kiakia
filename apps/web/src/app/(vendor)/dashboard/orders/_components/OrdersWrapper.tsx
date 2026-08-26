// app/(vendor)/orders/_components/OrdersWrapper.tsx
"use client";

import { useRouter } from "next/navigation";
import type { OrderStatus } from "@kiakia/db";
import { advanceOrderAction } from "@/app/actions/orders";
import { OrdersDesktop } from "./OrdersDesktop";
import { OrdersMobile } from "./OrdersMobile";
import type { Order } from "./types";

interface OrdersWrapperProps {
  orders: Order[];
}

export function OrdersWrapper({ orders }: OrdersWrapperProps) {
  const router = useRouter();

  // advanceOrderAction is the same transition_order()-backed Server Action
  // VendorOrderActions uses on the order detail page — it re-checks vendor
  // staff membership and validates the transition itself, so this is just
  // shaping the click into a call, same as CartContent's
  // action-then-router.refresh() pattern.
  const handleStatusChange = async (orderId: string, status: string) => {
    await advanceOrderAction(orderId, status as OrderStatus);
    router.refresh();
  };

  return (
    <>
      <div className="hidden lg:block">
        <OrdersDesktop orders={orders} onStatusChange={handleStatusChange} />
      </div>
      <div className="lg:hidden">
        <OrdersMobile orders={orders} onStatusChange={handleStatusChange} />
      </div>
    </>
  );
}
