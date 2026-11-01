// app/(customer)/orders/_components/FeaturedOrder.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import type { OrderStatus } from "@kiakia/domain";
import { OrderStatusBadge } from "@kiakia/ui";
import { MapPin, Phone, Clock, ForkKnifeCrossedIcon } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import type { Order } from "./types";
import { timeAgo } from "./timeAgo";

interface FeaturedOrderProps {
  order: Order;
  vendorName: string;
  vendorProfileImageUrl?: string | null;
}

export function FeaturedOrder({
  order,
  vendorName,
  vendorProfileImageUrl,
}: FeaturedOrderProps) {
  const getItemsSummary = (items?: Array<{ name: string; qty: number }>) => {
    if (!items || items.length === 0) return "No items";
    return items.map((item) => `${item.qty}x ${item.name}`).join(", ");
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-kk-hair bg-kk-card">
      <div className="flex h-[296px]">
        {/* Image Side */}
        <div className="relative w-[324px] shrink-0">
          <div className="h-full w-full bg-kk-fill">
            <div className="flex h-full w-full items-center justify-center bg-kk-hair text-6xl text-kk-cocoa/20">
              {vendorProfileImageUrl ? (
                <Image
                  src={vendorProfileImageUrl}
                  alt={vendorName}
                  fill
                  sizes="324px"
                  className="object-cover"
                />
              ) : (
                <span className="text-6xl">
                  <ForkKnifeCrossedIcon />
                </span>
              )}
            </div>
          </div>
          <div className="absolute left-4 top-4">
            <OrderStatusBadge
              status={order.status as OrderStatus}
              className="bg-kk-card/90 backdrop-blur-sm px-3"
            />
          </div>
        </div>

        {/* Content Side */}
        <div className="flex flex-1 flex-col justify-between p-6">
          <div>
            <div className="flex items-start justify-between">
              <h2 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.32px] text-kk-ink">
                {vendorName}
              </h2>
              <span className="font-sora text-2xl font-semibold text-kk-red-ink">
                {formatNaira(koboOf(order.total_kobo))}
              </span>
            </div>
            <p className="mt-1 font-inter text-base text-kk-cocoa">
              {getItemsSummary(order.items)}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Clock className="size-4 text-kk-orange-ink" />
              <span className="font-inter text-sm font-semibold text-kk-ink">
                Ordered {timeAgo(order.created_at)}
              </span>
            </div>
            <div className="mt-3 flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-kk-red-ink" />
              <span className="font-inter text-sm text-kk-cocoa">
                {order.delivery_address ?? "No delivery address on file"}
              </span>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Link
              href={`/orders/${order.id}/tracking`}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-kk-red px-4 py-3 font-inter text-sm font-bold text-white shadow-sm hover:bg-kk-red-hover"
            >
              <MapPin className="size-4" />
              Track Order
            </Link>
            <button className="rounded-xl border border-kk-line bg-kk-fill p-3 hover:bg-kk-fill-mid">
              <Phone className="size-4 text-kk-ink" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
