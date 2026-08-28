// app/(vendor)/history/_components/HistoryCard.tsx
"use client";

import { formatNaira, koboOf, type OrderStatus } from "@kiakia/domain";
import { OrderStatusBadge } from "@kiakia/ui";
import { Utensils } from "lucide-react";
import type { Order } from "./types";

interface HistoryCardProps {
  order: Order;
}

export function HistoryCard({ order }: HistoryCardProps) {
  const isCancelled =
    order.status === "cancelled_by_customer" ||
    order.status === "cancelled_by_platform";
  const isRejected = order.status === "rejected_by_vendor";

  return (
    <div
      className={`rounded-2xl border border-[#E4BEB8] bg-white p-5 shadow-sm transition-all hover:shadow-md ${
        isCancelled || isRejected ? "opacity-80" : ""
      }`}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        {/* Image */}
        <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-[#F0EDED]">
          <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1]">
            <Utensils className="size-8 text-[#5B403C]/40" />
          </div>
        </div>

        {/* Content */}
        <div className="grow">
          <div className="mb-1 flex items-start justify-between">
            <h3 className="font-inter text-lg font-bold text-[#1C1B1B]">
              {order.customer_name || "Customer"}
            </h3>
            <span className="font-inter text-sm font-bold text-[#B61913]">
              {formatNaira(koboOf(order.total_kobo))}
            </span>
          </div>
          <p className="mb-2 text-sm text-[#5B403C]">
            Order {order.code} • {order.items || "Order items"} •{" "}
            {new Date(order.created_at).toLocaleDateString("en-NG", {
              month: "short",
              day: "numeric",
            })}{" "}
            {new Date(order.created_at).toLocaleTimeString("en-NG", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <div className="flex items-center gap-2">
            <OrderStatusBadge status={order.status as OrderStatus} />
          </div>
        </div>

        {/* Actions */}
        <div className="mt-2 flex gap-2 md:mt-0 md:flex-col">
          {!isCancelled && !isRejected && (
            <button
              type="button"
              className="flex-1 rounded-xl border-2 border-[#934B00] px-4 py-2 text-sm font-medium text-[#934B00] transition-colors hover:bg-[rgba(147,75,0,0.05)] active:scale-95"
            >
              Reorder
            </button>
          )}
          <button
            type="button"
            className="flex-1 rounded-xl px-4 py-2 text-sm font-medium text-[#5B403C] transition-colors hover:bg-[#F0EDED] active:scale-95"
          >
            Details
          </button>
        </div>
      </div>
    </div>
  );
}
