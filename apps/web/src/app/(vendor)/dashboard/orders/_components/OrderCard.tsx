// app/(vendor)/orders/_components/OrderCard.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Clock, User } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import type { Order } from "./types";

interface OrderCardProps {
  order: Order;
  isActive?: boolean;
  onClick: (order: Order) => void;
}

export function OrderCard({ order, isActive, onClick }: OrderCardProps) {
  const getTimeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} mins ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  };

  return (
    <div
      className={`p-4 rounded-xl cursor-pointer transition-all ${
        isActive
          ? "bg-[rgba(218,53,41,0.05)] border-2 border-[#B61913]"
          : "bg-white border border-[#E4BEB8] hover:border-[#B61913]/40"
      }`}
      onClick={() => onClick(order)}
    >
      <div className="flex justify-between items-start mb-2">
        <div>
          <span className="text-sm font-bold text-[#5B403C]">{order.code}</span>
          <h3 className="font-sora text-lg font-bold text-[#1C1B1B]">
            {order.customer_name || "Customer"}
          </h3>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <div className="flex justify-between items-center text-[#5B403C]">
        <span className="text-sm">
          {order.items?.length || 0} Items •{" "}
          {formatNaira(koboOf(order.total_kobo))}
        </span>
        <span className="text-sm italic">{getTimeAgo(order.created_at)}</span>
      </div>
    </div>
  );
}
