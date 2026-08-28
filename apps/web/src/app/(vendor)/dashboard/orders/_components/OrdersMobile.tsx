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
  placed: "bg-[#B61913]",
  accepted: "bg-[#934B00]",
  preparing: "bg-[#934B00]",
  ready_for_pickup: "bg-[#176A22]",
  rider_assigned: "bg-[#176A22]",
  picked_up: "bg-[#176A22]",
  in_transit: "bg-[#176A22]",
  arrived: "bg-[#176A22]",
};

export function OrdersMobile({ orders, onStatusChange }: OrdersMobileProps) {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
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
    setSelectedOrder(order);
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
                ? "bg-[#B61913] text-white"
                : "bg-[#F0EDED] text-[#5B403C] hover:bg-[#E5E2E1]"
            }`}
          >
            {label === "All" ? `All (${orders.length})` : label}
          </button>
        ))}
        <Link
          href="/dashboard/history"
          className="rounded-full bg-[#F0EDED] px-6 py-2 text-sm font-medium text-[#5B403C] whitespace-nowrap transition-colors hover:bg-[#E5E2E1]"
        >
          Past Orders
        </Link>
      </div>

      {/* Orders Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredOrders.length === 0 ? (
          <p className="py-12 text-center text-sm text-[#5B403C]">No orders in this stage.</p>
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
                className="bg-white p-6 rounded-2xl border border-[#E4BEB8] shadow-sm hover:shadow-md transition-all cursor-pointer relative overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B61913]"
              >
                <div
                  className={`absolute top-0 left-0 w-1.5 h-full ${ACCENT_COLOR[order.status] ?? "bg-[#5B403C]"}`}
                />
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="text-sm text-[#5B403C] mb-1">
                      {new Date(order.created_at).toLocaleTimeString()}
                    </p>
                    <h3 className="font-sora text-xl font-bold text-[#1C1B1B]">
                      {order.code}
                    </h3>
                  </div>
                  <StatusBadge status={order.status} />
                </div>
                <div className="space-y-2 mb-6">
                  {order.items?.slice(0, 2).map((item) => (
                    <p key={item.id} className="text-sm text-[#1C1B1B]">
                      {item.quantity}x {item.name}
                    </p>
                  ))}
                  {(order.items?.length || 0) > 2 && (
                    <p className="text-sm text-[#5B403C]">
                      +{(order.items?.length || 0) - 2} more items
                    </p>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-[#F0EDED] flex items-center justify-center">
                      <User className="size-4 text-[#5B403C]/60" />
                    </div>
                    <span className="text-sm text-[#5B403C]">
                      {order.customer_name || "Customer"}
                    </span>
                  </div>
                  <p className="font-sora text-xl font-bold text-[#B61913]">
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
