// app/(customer)/orders/_components/MobileOrderCard.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import type { OrderStatus } from "@kiakia/domain";
import { OrderStatusBadge } from "@kiakia/ui";
import { Clock, MapPin, Truck, ForkKnifeCrossedIcon } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import type { Order } from "./types";
import { timeAgo } from "./timeAgo";

interface MobileOrderCardProps {
  order: Order;
  vendorName: string;
  vendorProfileImageUrl?: string | null;
}

export function MobileOrderCard({
  order,
  vendorName,
  vendorProfileImageUrl,
}: MobileOrderCardProps) {
  const getItemsSummary = (items?: Array<{ name: string; qty: number }>) => {
    if (!items || items.length === 0) return "No items";
    return items.map((item) => `${item.qty}x ${item.name}`).join(", ");
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "in_transit":
        return <Truck className="size-3.5" />;
      case "preparing":
        return <Clock className="size-3.5" />;
      default:
        return null;
    }
  };

  return (
    <div className="rounded-xl border border-[#E4BEB8] bg-white p-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-[#EAE7E7] bg-[#F0EDED]">
            {vendorProfileImageUrl ? (
              <Image
                src={vendorProfileImageUrl}
                alt={vendorName}
                fill
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1] text-[#5B403C]/40">
                <ForkKnifeCrossedIcon className="size-5" />
              </div>
            )}
          </div>
          <div>
            <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
              {vendorName}
            </p>
            <p className="font-inter text-xs text-[#5B403C]">{order.code}</p>
          </div>
        </div>
        <OrderStatusBadge
          className="px-3"
          status={order.status as OrderStatus}
          Icon={getStatusIcon(order.status)}
        />
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

      {/* Time since order was placed — honest, not a fabricated ETA */}
      <div className="flex items-center gap-3 rounded-lg bg-[#F6F3F2] p-3">
        <div
          className={`rounded-full p-2 text-white ${order.status === "in_transit" ? "bg-[#358439]" : "bg-[#FE8E27]"}`}
        >
          {getStatusIcon(order.status) ?? <Clock className="size-3.5" />}
        </div>
        <div>
          <p className="font-inter text-xs text-[#5B403C]">Ordered</p>
          <p
            className={`font-sora text-xl font-bold ${order.status === "in_transit" ? "text-[#358439]" : "text-[#1C1B1B]"}`}
          >
            {timeAgo(order.created_at)}
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
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#B61913] py-2.5 font-inter text-sm font-semibold text-white shadow-sm"
        >
          <MapPin className="size-3" />
          Track Order
        </button>
      </div>
    </div>
  );
}
