// app/(customer)/orders/_components/FeaturedOrder.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { OrderStatusBadge } from "@kiakia/ui";
import { MapPin, Phone, Clock } from "lucide-react";
import Link from "next/link";
import type { Order } from "./types";

interface FeaturedOrderProps {
  order: Order;
  vendorName: string;
}

export function FeaturedOrder({ order, vendorName }: FeaturedOrderProps) {
  const getItemsSummary = (items?: Array<{ name: string; qty: number }>) => {
    if (!items || items.length === 0) return "No items";
    return items.map((item) => `${item.qty}x ${item.name}`).join(", ");
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
    <div className="overflow-hidden rounded-2xl border border-[#E5E2E1] bg-white">
      <div className="flex h-[296px]">
        {/* Image Side */}
        <div className="relative w-[324px] shrink-0">
          <div className="h-full w-full bg-[#F0EDED]">
            <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1] text-6xl text-[#5B403C]/20">
              🍽️
            </div>
          </div>
          <div className="absolute left-4 top-4">
            <OrderStatusBadge
              status={order.status as any}
              className="bg-white/90 backdrop-blur-sm"
            />
          </div>
        </div>

        {/* Content Side */}
        <div className="flex flex-1 flex-col justify-between p-6">
          <div>
            <div className="flex items-start justify-between">
              <h2 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.32px] text-[#1C1B1B]">
                {vendorName}
              </h2>
              <span className="font-sora text-2xl font-semibold text-[#B61913]">
                {formatNaira(koboOf(order.total_kobo))}
              </span>
            </div>
            <p className="mt-1 font-inter text-base text-[#5B403C]">
              {getItemsSummary(order.items)}
            </p>
            <div className="mt-4 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-[#5B403C]" />
                <span className="font-inter text-sm font-semibold text-[#5B403C]">
                  {eta.label}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-inter text-sm font-semibold text-[#934B00]">
                  {eta.time}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Link
              href={`/orders/${order.id}/tracking`}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#B61913] px-4 py-3 font-inter text-sm font-bold text-white shadow-sm hover:bg-[#9e1611]"
            >
              <MapPin className="size-4" />
              Track Order
            </Link>
            <button className="rounded-xl border border-[#E4BEB8] bg-[#F0EDED] p-3 hover:bg-[#e5e2e2]">
              <Phone className="size-4 text-[#1C1B1B]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
