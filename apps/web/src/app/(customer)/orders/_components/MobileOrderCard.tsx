// app/(customer)/orders/_components/MobileOrderCard.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { OrderStatusBadge } from "@kiakia/ui";
import { Clock, MapPin, Truck } from "lucide-react";
import Link from "next/link";
import type { Order } from "./types";

interface MobileOrderCardProps {
  order: Order;
  vendorName: string;
}

export function MobileOrderCard({ order, vendorName }: MobileOrderCardProps) {
  const getItemsSummary = (items?: Array<{ name: string; qty: number }>) => {
    if (!items || items.length === 0) return "No items";
    return items.map((item) => `${item.qty}x ${item.name}`).join(", ");
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "out_for_delivery":
        return <Truck className="size-3.5" />;
      case "preparing":
        return <Clock className="size-3.5" />;
      default:
        return null;
    }
  };

  const getETA = (status: string) => {
    switch (status) {
      case "out_for_delivery":
        return { label: "Estimated delivery", time: "15-20 min" };
      case "preparing":
        return { label: "Estimated prep time", time: "25-30 min" };
      default:
        return { label: "Estimated time", time: "30 min" };
    }
  };

  const eta = getETA(order.status);

  return (
    <div className="rounded-xl border border-[#E4BEB8] bg-white p-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 overflow-hidden rounded-full border border-[#EAE7E7] bg-[#F0EDED]">
            <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1] text-xl">
              🍽️
            </div>
          </div>
          <div>
            <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
              {vendorName}
            </p>
            <p className="font-inter text-xs text-[#5B403C]">{order.code}</p>
          </div>
        </div>
        <OrderStatusBadge status={order.status as any} />
      </div>

      {/* Body */}
      <div className="my-3 border-y border-[#EAE7E7] py-3">
        <div className="flex justify-between">
          <p className="font-inter text-sm text-[#5B403C]">
            {getItemsSummary(order.items)}
          </p>
          <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
            {formatNaira(koboOf(order.total_kobo))}
          </p>
        </div>
      </div>

      {/* ETA */}
      <div className="flex items-center gap-3 rounded-lg bg-[#F6F3F2] p-3">
        <div
          className={`rounded-full p-2 ${order.status === "out_for_delivery" ? "bg-[#358439]" : "bg-[#FE8E27]"}`}
        >
          {getStatusIcon(order.status)}
        </div>
        <div>
          <p className="font-inter text-xs text-[#5B403C]">{eta.label}</p>
          <p className="font-sora text-xl font-bold text-[#176A22]">
            {eta.time}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex gap-3">
        <Link
          href={`/orders/${order.id}`}
          className="flex flex-1 items-center justify-center rounded-xl bg-[#F0EDED] py-2.5 font-inter text-sm font-semibold text-[#1C1B1B]"
        >
          View Details
        </Link>
        <button className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#B61913] py-2.5 font-inter text-sm font-semibold text-white shadow-sm">
          <MapPin className="size-3" />
          Track Order
        </button>
      </div>
    </div>
  );
}
