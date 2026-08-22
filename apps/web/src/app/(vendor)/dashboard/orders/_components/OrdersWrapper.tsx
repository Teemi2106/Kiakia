// app/(vendor)/orders/_components/OrdersWrapper.tsx
"use client";

import { useState } from "react";
import { OrdersDesktop } from "./OrdersDesktop";
import { OrdersMobile } from "./OrdersMobile";
import type { Order } from "./types";

interface OrdersWrapperProps {
  orders: Order[];
}

export function OrdersWrapper({ orders }: OrdersWrapperProps) {
  const [orderList, setOrderList] = useState(orders);

  const handleStatusChange = async (orderId: string, status: string) => {
    // This will be implemented when connecting to Supabase
    console.log(`Order ${orderId} status changed to ${status}`);

    // For demo: update local state
    setOrderList((prev) =>
      prev.map((order) =>
        order.id === orderId ? { ...order, status } : order,
      ),
    );
  };

  return (
    <>
      <div className="hidden lg:block">
        <OrdersDesktop orders={orderList} onStatusChange={handleStatusChange} />
      </div>
      <div className="lg:hidden">
        <OrdersMobile orders={orderList} onStatusChange={handleStatusChange} />
      </div>
    </>
  );
}
