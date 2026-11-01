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
    // eslint-disable-next-line react-hooks/purity -- relative "time ago" display genuinely needs the current wall-clock time; not used for anything correctness-sensitive
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} mins ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(order)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(order);
        }
      }}
      className={`cursor-pointer rounded-xl p-4 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kk-red-ink ${
        isActive
          ? "bg-[rgba(218,53,41,0.05)] border-2 border-kk-red"
          : "bg-kk-card border border-kk-line hover:border-kk-red/40 hover:shadow-sm"
      }`}
    >
      <div className="flex justify-between items-start mb-2">
        <div>
          <span className="text-sm font-bold text-kk-cocoa">{order.code}</span>
          <h3 className="flex items-center gap-1.5 font-sora text-lg font-bold text-kk-ink">
            <User className="size-4 text-kk-cocoa/50" />
            {order.customer_name || "Customer"}
          </h3>
        </div>
        <StatusBadge status={order.status} />
      </div>
      {order.dispatch?.state === "no_rider_nearby" && order.delivery_by !== "vendor" && (
        <p className="mb-2 rounded-lg bg-notice-surface px-3 py-2 text-xs font-semibold text-kk-orange-ink">
          No rider is near you right now. Open this order to choose what to do.
        </p>
      )}
      {order.delivery_by === "vendor" && order.status !== "delivered" && (
        <p className="mb-2 rounded-lg bg-kk-fill px-3 py-2 text-xs font-semibold text-kk-cocoa">You are delivering this order.</p>
      )}
      <div className="flex justify-between items-center text-kk-cocoa">
        <span className="text-sm">
          {order.items?.length || 0} Items •{" "}
          {formatNaira(koboOf(order.total_kobo))}
        </span>
        <span className="flex items-center gap-1 text-sm italic">
          <Clock className="size-3.5" />
          {getTimeAgo(order.created_at)}
        </span>
      </div>
    </div>
  );
}
