// app/(vendor)/orders/_components/OrdersDesktop.tsx
"use client";

import { useState } from "react";
import { OrderList } from "./OrderList";
import { OrderDetail } from "./OrderDetail";
import type { Order } from "./types";

interface OrdersDesktopProps {
  orders: Order[];
  onStatusChange: (orderId: string, status: string) => void;
}

export function OrdersDesktop({ orders, onStatusChange }: OrdersDesktopProps) {
  // Stored by id, not the full object — `orders` is re-fetched server-side
  // (and this component re-rendered with a new array) after every status
  // change, so re-deriving from the fresh array keeps the detail panel in
  // sync instead of showing a stale, pre-transition order.
  const [selectedId, setSelectedId] = useState<string | null>(
    orders[0]?.id ?? null,
  );
  const selectedOrder =
    orders.find((order) => order.id === selectedId) ?? orders[0] ?? null;

  return (
    <div className="flex flex-1 overflow-hidden h-[calc(100vh-80px)]">
      {/* Left Panel: Order List */}
      <section className="w-[380px] lg:w-[420px] flex flex-col border-r border-[#E4BEB8] bg-[#FCF9F8]">
        <OrderList
          orders={orders}
          selectedOrder={selectedOrder}
          onSelectOrder={(order) => setSelectedId(order.id)}
        />
      </section>

      {/* Right Panel: Order Detail */}
      <section className="flex-1 flex flex-col bg-[#F6F3F2] overflow-y-auto">
        {selectedOrder ? (
          <OrderDetail order={selectedOrder} onStatusChange={onStatusChange} />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[#5B403C]">Select an order to view details</p>
          </div>
        )}
      </section>
    </div>
  );
}
