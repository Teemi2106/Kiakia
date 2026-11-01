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
      <div className="p-4 bg-kk-card border-b border-kk-line">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-kk-cocoa" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search order ID or customer..."
            className="w-full rounded-xl bg-kk-fill pl-10 pr-4 py-2 text-sm text-kk-ink placeholder:text-kk-cocoa focus:outline-none focus:ring-2 focus:ring-kk-red-ink/20"
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
                  ? "bg-kk-red text-white"
                  : "bg-kk-fill text-kk-cocoa hover:bg-kk-hair"
              }`}
            >
              {label === "All" ? `All (${orders.length})` : label}
            </button>
          ))}
          <Link
            href="/dashboard/history"
            className="rounded-full bg-kk-fill px-4 py-1.5 text-sm font-medium text-kk-cocoa whitespace-nowrap transition-colors hover:bg-kk-hair"
          >
            Past Orders
          </Link>
        </div>
      </div>

      {/* Orders List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {filteredOrders.length === 0 ? (
          <p className="p-6 text-center text-sm text-kk-cocoa">No orders match.</p>
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
