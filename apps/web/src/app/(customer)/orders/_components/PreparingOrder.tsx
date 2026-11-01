// app/(customer)/orders/_components/PreparingOrder.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import type { OrderStatus } from "@kiakia/domain";
import { OrderStatusBadge } from "@kiakia/ui";
import { Clock, ForkKnifeCrossedIcon } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import type { Order } from "./types";
import { timeAgo } from "./timeAgo";

interface PreparingOrderProps {
  order: Order;
  vendorName: string;
  vendorProfileImageUrl?: string | null;
}

export function PreparingOrder({
  order,
  vendorName,
  vendorProfileImageUrl,
}: PreparingOrderProps) {
  const getItemsSummary = (items?: Array<{ name: string; qty: number }>) => {
    if (!items || items.length === 0) return "No items";
    return items.map((item) => `${item.qty}x ${item.name}`).join(", ");
  };

  return (
    <div className="rounded-2xl border border-kk-hair bg-kk-card p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 overflow-hidden rounded-full border border-kk-hair bg-kk-fill">
            <div className="flex h-full w-full items-center justify-center bg-kk-hair text-xl">
              {vendorProfileImageUrl ? (
                <div className="relative h-full w-full">
                  <Image
                    src={vendorProfileImageUrl}
                    alt={vendorName}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                </div>
              ) : (
                <span className="text-2xl">
                  <ForkKnifeCrossedIcon />
                </span>
              )}
            </div>
          </div>
          <div>
            <h3 className="font-sora text-2xl font-semibold leading-8 text-kk-ink">
              {vendorName}
            </h3>
            <p className="font-inter text-xs text-kk-cocoa">{order.code}</p>
          </div>
        </div>
        <OrderStatusBadge className="px-3" status={order.status as OrderStatus} />
      </div>

      <div className="mt-4">
        <p className="font-inter text-sm text-kk-cocoa">
          {getItemsSummary(order.items)}
        </p>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-kk-sand px-3 py-2">
        <Clock className="size-4 text-kk-orange-ink" />
        <span className="font-inter text-xs font-semibold text-kk-orange-ink">
          Ordered {timeAgo(order.created_at)}
        </span>
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-kk-hair-soft pt-4">
        <div>
          <p className="font-inter text-xs text-kk-cocoa">Total</p>
          <p className="font-sora text-2xl font-semibold text-kk-ink">
            {formatNaira(koboOf(order.total_kobo))}
          </p>
        </div>
        <Link
          href={`/orders/${order.id}`}
          className="flex items-center gap-1 font-inter text-sm font-bold text-kk-orange-ink hover:underline"
        >
          View details
          <span className="text-kk-orange-ink">→</span>
        </Link>
      </div>
    </div>
  );
}
