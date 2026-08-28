// app/(customer)/orders/[id]/_components/OrderSummaryDetails.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import type { OrderDetail, OrderItem } from "./types";
import Image from "next/image";
import { ForkKnifeCrossedIcon } from "lucide-react";

interface OrderSummaryDetailsProps {
  items: OrderItem[];
  order: OrderDetail;
  vendorImage?: string | null;
}

export function OrderSummaryDetails({
  items,
  order,
  vendorImage,
}: OrderSummaryDetailsProps) {
  return (
    <div className="space-y-4">
      <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
        Order Summary
      </h2>

      {/* Items List */}
      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-4 rounded-xl border border-[#E5E2E1] p-4"
          >
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[#F0EDED]">
              {vendorImage ? (
                <Image
                  src={vendorImage}
                  alt={item.name_snapshot}
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1] text-[#5B403C]/40">
                  <ForkKnifeCrossedIcon className="size-6" />
                </div>
              )}
            </div>
            <div className="flex flex-1 items-center justify-between">
              <div>
                <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
                  {item.name_snapshot}
                </p>
                <p className="font-inter text-sm text-[#5B403C]">
                  Qty: {item.qty}
                </p>
              </div>
              <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
                {formatNaira(koboOf(item.line_total_kobo))}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="space-y-2 border-t border-[#E5E2E1] pt-4">
        <div className="flex items-center justify-between">
          <span className="font-inter text-sm text-[#5B403C]">Subtotal</span>
          <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
            {formatNaira(koboOf(order.subtotal_kobo))}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-inter text-sm text-[#5B403C]">
            Delivery Fee
          </span>
          <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
            {formatNaira(koboOf(order.delivery_fee_kobo))}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-inter text-sm text-[#5B403C]">Service Fee</span>
          <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
            {formatNaira(koboOf(order.service_fee_kobo))}
          </span>
        </div>
        {order.discount_kobo > 0 && (
          <div className="flex items-center justify-between text-[#176A22]">
            <span className="font-inter text-sm">Discount</span>
            <span className="font-inter text-sm font-semibold">
              −{formatNaira(koboOf(order.discount_kobo))}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-[#E5E2E1] pt-3">
          <span className="font-sora text-2xl font-semibold text-[#1C1B1B]">
            Total
          </span>
          <span className="font-sora text-2xl font-semibold text-[#B61913]">
            {formatNaira(koboOf(order.total_kobo))}
          </span>
        </div>
      </div>
    </div>
  );
}
