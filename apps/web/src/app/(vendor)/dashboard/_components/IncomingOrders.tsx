// app/(vendor)/dashboard/_components/IncomingOrders.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { ChevronRight, Clock, Utensils } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { Order } from "./types";

interface IncomingOrdersProps {
  orders: Order[];
  variant?: "desktop" | "mobile";
}

export function IncomingOrders({
  orders,
  variant = "desktop",
}: IncomingOrdersProps) {
  const isDesktop = variant === "desktop";

  const getStatusColor = (status: string) => {
    switch (status) {
      case "preparing":
        return "bg-[#FE8E27]/10 text-[#FE8E27]";
      case "ready_for_pickup":
        return "bg-[#176A22]/10 text-[#176A22]";
      case "placed":
        return "bg-[#B61913]/10 text-[#B61913]";
      default:
        return "bg-[#E5E2E1] text-[#5B403C]";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "preparing":
        return "PREPARING";
      case "ready_for_pickup":
        return "PICK-UP READY";
      case "placed":
        return "NEW";
      default:
        return status.toUpperCase();
    }
  };

  if (isDesktop) {
    return (
      <div className="space-y-4">
        {orders.map((order) => (
          <Link
            key={order.id}
            href={`/dashboard/orders/${order.id}`}
            className="group flex items-center gap-4 rounded-2xl border border-[#E4BEB8] bg-white p-4 transition-colors hover:border-[#B61913] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B61913]/40"
          >
            {/* Image */}
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[#F0EDED]">
              {order.image ? (
                <Image
                  src={order.image}
                  alt="Order item"
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1]">
                  <Utensils className="size-8 text-[#5B403C]/40" />
                </div>
              )}
            </div>

            {/* Details */}
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <h4 className="font-inter font-bold text-[#1C1B1B] transition-colors group-hover:text-[#B61913]">
                  {order.items || "Order items"}
                </h4>
                <span className="font-inter text-xs font-medium leading-4 text-[#5B403C]">
                  {order.code}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-bold ${getStatusColor(order.status)}`}
                >
                  {getStatusLabel(order.status)}
                </span>
                <span className="flex items-center gap-1 text-sm text-[#5B403C]">
                  <Clock className="size-3.5" />
                  {order.eta || "In progress"}
                </span>
              </div>
            </div>

            {/* Right Side */}
            <div className="flex items-center gap-3">
              <p className="font-bold text-[#1C1B1B]">
                {formatNaira(koboOf(order.total_kobo))}
              </p>
              <ChevronRight className="size-4 text-[#5B403C] transition-transform group-hover:translate-x-0.5 group-hover:text-[#B61913]" />
            </div>
          </Link>
        ))}
      </div>
    );
  }

  // Mobile version - horizontal scroll cards
  return (
    <div className="relative w-full overflow-x-auto pb-4 hide-scrollbar">
      <div className="flex gap-4 w-max">
        {orders.map((order) => (
          <Link
            key={order.id}
            href={`/dashboard/orders/${order.id}`}
            className="w-[280px] shrink-0 overflow-hidden rounded-2xl border border-[#E4BEB8] bg-white shadow-sm transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B61913]/40"
          >
            <div className="relative h-32 w-full overflow-hidden bg-[#F0EDED]">
              {order.image ? (
                <Image
                  src={order.image}
                  alt="Order item"
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1]">
                  <Utensils className="size-12 text-[#5B403C]/30" />
                </div>
              )}
              <div className="absolute left-3 top-3 rounded-full bg-white px-3 py-1 text-xs font-bold text-[#B61913] shadow-sm">
                {getStatusLabel(order.status)}
              </div>
            </div>
            <div className="p-4">
              <div className="mb-2 flex items-start justify-between">
                <h3 className="font-inter text-sm font-bold text-[#1C1B1B]">
                  {order.items || "Order items"}
                </h3>
                <span className="font-bold text-[#B61913]">
                  {formatNaira(koboOf(order.total_kobo))}
                </span>
              </div>
              <p className="mb-4 text-xs text-[#5B403C]">{order.code}</p>
              <div className="flex items-center justify-between rounded-xl bg-[#FCF9F8] px-3 py-2 text-xs font-bold text-[#B61913]">
                Manage order
                <ChevronRight className="size-3.5" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
