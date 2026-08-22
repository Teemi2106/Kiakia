// app/(vendor)/orders/_components/OrderList.tsx
"use client";

import { Search, Filter } from "lucide-react";
import { OrderCard } from "./OrderCard";
import type { Order } from "./types";

interface OrderListProps {
  orders: Order[];
  selectedOrder: Order | null;
  onSelectOrder: (order: Order) => void;
  variant?: "desktop" | "mobile";
}

export function OrderList({
  orders,
  selectedOrder,
  onSelectOrder,
  variant = "desktop",
}: OrderListProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Search Bar */}
      <div className="p-4 bg-white border-b border-[#E4BEB8]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#5B403C]" />
          <input
            type="text"
            placeholder="Search order ID or customer..."
            className="w-full rounded-xl bg-[#F0EDED] pl-10 pr-4 py-2 text-sm text-[#1C1B1B] placeholder:text-[#5B403C] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
          />
        </div>
        <div className="flex gap-2 mt-4 overflow-x-auto">
          <button className="rounded-full bg-[#B61913] px-4 py-1.5 text-sm font-medium text-white whitespace-nowrap">
            Active ({orders.length})
          </button>
          <button className="rounded-full bg-[#F0EDED] px-4 py-1.5 text-sm font-medium text-[#5B403C] whitespace-nowrap">
            Incoming (2)
          </button>
          <button className="rounded-full bg-[#F0EDED] px-4 py-1.5 text-sm font-medium text-[#5B403C] whitespace-nowrap">
            Completed
          </button>
        </div>
      </div>

      {/* Orders List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            isActive={selectedOrder?.id === order.id}
            onClick={onSelectOrder}
          />
        ))}
      </div>
    </div>
  );
}
