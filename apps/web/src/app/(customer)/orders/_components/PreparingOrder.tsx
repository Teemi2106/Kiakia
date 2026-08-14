// app/(customer)/orders/_components/PreparingOrder.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { OrderStatusBadge } from "@kiakia/ui";
import Link from "next/link";
import type { Order } from "./types";

interface PreparingOrderProps {
  order: Order;
  vendorName: string;
}

export function PreparingOrder({ order, vendorName }: PreparingOrderProps) {
  const getItemsSummary = (items?: Array<{ name: string; qty: number }>) => {
    if (!items || items.length === 0) return "No items";
    return items.map((item) => `${item.qty}x ${item.name}`).join(", ");
  };

  const getProgress = (status: string) => {
    switch (status) {
      case "out_for_delivery":
        return 66;
      case "preparing":
        return 33;
      default:
        return 0;
    }
  };

  return (
    <div className="rounded-2xl border border-[#E5E2E1] bg-white p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 overflow-hidden rounded-full border border-[#E5E2E1] bg-[#F0EDED]">
            <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1] text-xl">
              🍽️
            </div>
          </div>
          <div>
            <h3 className="font-sora text-2xl font-semibold leading-8 text-[#1C1B1B]">
              {vendorName}
            </h3>
            <p className="font-inter text-xs text-[#5B403C]">{order.code}</p>
          </div>
        </div>
        <OrderStatusBadge status={order.status as any} />
      </div>

      <div className="mt-4">
        <p className="font-inter text-sm text-[#5B403C]">
          {getItemsSummary(order.items)}
        </p>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="font-inter text-xs text-[#5B403C]">Progress</span>
          <span className="font-inter text-xs font-semibold text-[#934B00]">
            {getProgress(order.status)}%
          </span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#E5E2E1]">
          <div
            className="h-full rounded-full bg-[#934B00]"
            style={{ width: `${getProgress(order.status)}%` }}
          />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-[#EAE7E7] pt-4">
        <div>
          <p className="font-inter text-xs text-[#5B403C]">Total</p>
          <p className="font-sora text-2xl font-semibold text-[#1C1B1B]">
            {formatNaira(koboOf(order.total_kobo))}
          </p>
        </div>
        <Link
          href={`/orders/${order.id}`}
          className="flex items-center gap-1 font-inter text-sm font-bold text-[#934B00] hover:underline"
        >
          View details
          <span className="text-[#934B00]">→</span>
        </Link>
      </div>
    </div>
  );
}
