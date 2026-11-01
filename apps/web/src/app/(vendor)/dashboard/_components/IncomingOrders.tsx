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
        return "bg-kk-orange/10 text-kk-orange";
      case "ready_for_pickup":
        return "bg-kk-green/10 text-kk-green-ink";
      case "placed":
        return "bg-kk-red/10 text-kk-red-ink";
      default:
        return "bg-kk-hair text-kk-cocoa";
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
            className="group flex items-center gap-4 rounded-2xl border border-kk-line bg-kk-card p-4 transition-colors hover:border-kk-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kk-red-ink/40"
          >
            {/* Image */}
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-kk-fill">
              {order.image ? (
                <Image
                  src={order.image}
                  alt="Order item"
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-kk-hair">
                  <Utensils className="size-8 text-kk-cocoa/40" />
                </div>
              )}
            </div>

            {/* Details */}
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <h4 className="font-inter font-bold text-kk-ink transition-colors group-hover:text-kk-red-ink">
                  {order.items || "Order items"}
                </h4>
                <span className="font-inter text-xs font-medium leading-4 text-kk-cocoa">
                  {order.code}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-bold ${getStatusColor(order.status)}`}
                >
                  {getStatusLabel(order.status)}
                </span>
                <span className="flex items-center gap-1 text-sm text-kk-cocoa">
                  <Clock className="size-3.5" />
                  {order.eta || "In progress"}
                </span>
              </div>
            </div>

            {/* Right Side */}
            <div className="flex items-center gap-3">
              <p className="font-bold text-kk-ink">
                {formatNaira(koboOf(order.total_kobo))}
              </p>
              <ChevronRight className="size-4 text-kk-cocoa transition-transform group-hover:translate-x-0.5 group-hover:text-kk-red-ink" />
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
            className="w-[280px] shrink-0 overflow-hidden rounded-2xl border border-kk-line bg-kk-card shadow-sm transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kk-red-ink/40"
          >
            <div className="relative h-32 w-full overflow-hidden bg-kk-fill">
              {order.image ? (
                <Image
                  src={order.image}
                  alt="Order item"
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-kk-hair">
                  <Utensils className="size-12 text-kk-cocoa/30" />
                </div>
              )}
              <div className="absolute left-3 top-3 rounded-full bg-kk-card px-3 py-1 text-xs font-bold text-kk-red-ink shadow-sm">
                {getStatusLabel(order.status)}
              </div>
            </div>
            <div className="p-4">
              <div className="mb-2 flex items-start justify-between">
                <h3 className="font-inter text-sm font-bold text-kk-ink">
                  {order.items || "Order items"}
                </h3>
                <span className="font-bold text-kk-red-ink">
                  {formatNaira(koboOf(order.total_kobo))}
                </span>
              </div>
              <p className="mb-4 text-xs text-kk-cocoa">{order.code}</p>
              <div className="flex items-center justify-between rounded-xl bg-kk-cream px-3 py-2 text-xs font-bold text-kk-red-ink">
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
