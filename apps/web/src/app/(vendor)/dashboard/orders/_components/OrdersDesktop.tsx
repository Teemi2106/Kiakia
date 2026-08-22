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
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(
    orders[0] || null,
  );

  return (
    <div className="flex flex-1 overflow-hidden h-[calc(100vh-80px)]">
      {/* Left Panel: Order List */}
      <section className="w-[380px] lg:w-[420px] flex flex-col border-r border-[#E4BEB8] bg-[#FCF9F8]">
        <OrderList
          orders={orders}
          selectedOrder={selectedOrder}
          onSelectOrder={setSelectedOrder}
          variant="desktop"
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
