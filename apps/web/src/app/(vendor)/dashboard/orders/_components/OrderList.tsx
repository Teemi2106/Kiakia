// app/(vendor)/orders/_components/OrderList.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { OrderCard } from "./OrderCard";
import type { Order } from "./types";

interface OrderListProps {
  orders: Order[];
  selectedOrder: Order | null;
  onSelectOrder: (order: Order) => void;
}

const STAGE_STATUSES: Record<string, readonly string[]> = {
  Incoming: ["placed"],
  Preparing: ["accepted", "preparing"],
  "Out for delivery": [
    "ready_for_pickup",
    "rider_assigned",
    "picked_up",
    "in_transit",
    "arrived",
  ],
};

export function OrderList({ orders, selectedOrder, onSelectOrder }: OrderListProps) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<string>("All");

  const stages = useMemo(() => {
    const present = Object.entries(STAGE_STATUSES).filter(([, statuses]) =>
      orders.some((order) => statuses.includes(order.status)),
    );
    return ["All", ...present.map(([label]) => label)];
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesQuery =
        query.trim().length === 0 ||
        order.code.toLowerCase().includes(query.toLowerCase()) ||
        (order.customer_name ?? "").toLowerCase().includes(query.toLowerCase());

      const matchesStage =
        stage === "All" || (STAGE_STATUSES[stage] ?? []).includes(order.status);

      return matchesQuery && matchesStage;
    });
  }, [orders, query, stage]);

  return (
    <div className="flex flex-col h-full">
      {/* Search Bar */}
      <div className="p-4 bg-white border-b border-[#E4BEB8]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#5B403C]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search order ID or customer..."
            className="w-full rounded-xl bg-[#F0EDED] pl-10 pr-4 py-2 text-sm text-[#1C1B1B] placeholder:text-[#5B403C] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
          />
        </div>
        <div className="flex gap-2 mt-4 overflow-x-auto">
          {stages.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => setStage(label)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                stage === label
                  ? "bg-[#B61913] text-white"
                  : "bg-[#F0EDED] text-[#5B403C] hover:bg-[#E5E2E1]"
              }`}
            >
              {label === "All" ? `All (${orders.length})` : label}
            </button>
          ))}
          <Link
            href="/dashboard/history"
            className="rounded-full bg-[#F0EDED] px-4 py-1.5 text-sm font-medium text-[#5B403C] whitespace-nowrap transition-colors hover:bg-[#E5E2E1]"
          >
            Past Orders
          </Link>
        </div>
      </div>

      {/* Orders List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {filteredOrders.length === 0 ? (
          <p className="p-6 text-center text-sm text-[#5B403C]">No orders match.</p>
        ) : (
          filteredOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              isActive={selectedOrder?.id === order.id}
              onClick={onSelectOrder}
            />
          ))
        )}
      </div>
    </div>
  );
}
