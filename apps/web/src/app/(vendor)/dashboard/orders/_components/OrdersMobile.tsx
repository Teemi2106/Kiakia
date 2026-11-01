// app/(vendor)/orders/_components/OrdersMobile.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { User } from "lucide-react";
import { formatNaira, koboOf } from "@kiakia/domain";
import { OrderModal } from "./OrderModal";
import { StatusBadge } from "./StatusBadge";
import type { Order } from "./types";

interface OrdersMobileProps {
  orders: Order[];
  onStatusChange: (orderId: string, status: string) => void;
}

const STAGE_STATUSES: Record<string, readonly string[]> = {
  Incoming: ["placed"],
  Preparing: ["accepted", "preparing"],
  Ready: ["ready_for_pickup", "rider_assigned", "picked_up", "in_transit", "arrived"],
};

const ACCENT_COLOR: Record<string, string> = {
  placed: "bg-kk-red",
  accepted: "bg-[#934B00]",
  preparing: "bg-[#934B00]",
  ready_for_pickup: "bg-kk-green",
  rider_assigned: "bg-kk-green",
  picked_up: "bg-kk-green",
  in_transit: "bg-kk-green",
  arrived: "bg-kk-green",
};

export function OrdersMobile({ orders, onStatusChange }: OrdersMobileProps) {
  // By id, re-derived from the current list each render, so the open modal
  // follows an optimistic or refreshed status instead of showing a stale copy
  // (and closes by itself when the order leaves the list).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const selectedOrder = orders.find((order) => order.id === selectedId) ?? null;
  const [stage, setStage] = useState<string>("All");

  const stages = useMemo(() => {
    const present = Object.entries(STAGE_STATUSES).filter(([, statuses]) =>
      orders.some((order) => statuses.includes(order.status)),
    );
    return ["All", ...present.map(([label]) => label)];
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (stage === "All") return orders;
    return orders.filter((order) => (STAGE_STATUSES[stage] ?? []).includes(order.status));
  }, [orders, stage]);

  const handleSelectOrder = (order: Order) => {
    setSelectedId(order.id);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 px-4 pt-4">
        {stages.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => setStage(label)}
            className={`rounded-full px-6 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
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
          className="rounded-full bg-kk-fill px-6 py-2 text-sm font-medium text-kk-cocoa whitespace-nowrap transition-colors hover:bg-kk-hair"
        >
          Past Orders
        </Link>
      </div>

      {/* Orders Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredOrders.length === 0 ? (
          <p className="py-12 text-center text-sm text-kk-cocoa">No orders in this stage.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredOrders.map((order) => (
              <div
                key={order.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectOrder(order)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectOrder(order);
                  }
                }}
                className="bg-kk-card p-6 rounded-2xl border border-kk-line shadow-sm hover:shadow-md transition-all cursor-pointer relative overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kk-red-ink"
              >
                <div
                  className={`absolute top-0 left-0 w-1.5 h-full ${ACCENT_COLOR[order.status] ?? "bg-kk-cocoa"}`}
                />
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="text-sm text-kk-cocoa mb-1">
                      {new Date(order.created_at).toLocaleTimeString()}
                    </p>
                    <h3 className="font-sora text-xl font-bold text-kk-ink">
                      {order.code}
                    </h3>
                  </div>
                  <StatusBadge status={order.status} />
                </div>
                <div className="space-y-2 mb-6">
                  {order.items?.slice(0, 2).map((item) => (
                    <p key={item.id} className="text-sm text-kk-ink">
                      {item.quantity}x {item.name}
                    </p>
                  ))}
                  {(order.items?.length || 0) > 2 && (
                    <p className="text-sm text-kk-cocoa">
                      +{(order.items?.length || 0) - 2} more items
                    </p>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-kk-fill flex items-center justify-center">
                      <User className="size-4 text-kk-cocoa/60" />
                    </div>
                    <span className="text-sm text-kk-cocoa">
                      {order.customer_name || "Customer"}
                    </span>
                  </div>
                  <p className="font-sora text-xl font-bold text-kk-red-ink">
                    {formatNaira(koboOf(order.total_kobo))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Order Modal */}
      <OrderModal
        order={selectedOrder}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onStatusChange={onStatusChange}
      />
    </div>
  );
}
