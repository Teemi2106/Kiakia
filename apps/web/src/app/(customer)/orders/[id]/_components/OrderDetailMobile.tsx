// app/(customer)/orders/[id]/_components/OrderDetailMobile.tsx
"use client";

import { ChevronLeft, MapPin, MessageCircle, Share2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OrderDetailHeader } from "./OrderDetailHeader";
import { DeliveryCodeSection } from "./DeliveryCodeSection";
import { OrderSummaryDetails } from "./OrderSummaryDetails";
import type { OrderDetail, Vendor, OrderItem } from "./types";

interface OrderDetailMobileProps {
  order: OrderDetail;
  vendor: Vendor | null;
  items: OrderItem[];
}

export function OrderDetailMobile({
  order,
  vendor,
  items,
}: OrderDetailMobileProps) {
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col pt-20 pb-8 bg-[#FCF9F8]">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#FCF9F8] px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="rounded-lg p-2 hover:bg-black/5"
            aria-label="Go back"
          >
            <ChevronLeft className="size-4 text-[#1C1B1B]" />
          </button>
          <h1 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
            Order Confirmed
          </h1>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 space-y-6 px-4 pb-8 pt-6">
        {/* Status Section */}
        <div className="rounded-2xl border border-[#E4BEB8] bg-white p-6 shadow-sm">
          <OrderDetailHeader
            status={order.status}
            vendorName={vendor?.name || "Vendor"}
          />
        </div>

        {/* Delivery Code */}
        <DeliveryCodeSection deliveryCode={order.delivery_code} />

        {/* Order Summary */}
        <div className="rounded-2xl border border-[#E4BEB8] bg-white p-4 shadow-sm">
          <OrderSummaryDetails items={items} order={order} />
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <button className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#934B00] bg-[#FCF9F8] px-6 py-4 font-inter text-sm font-semibold text-[#934B00] hover:bg-[#f0edec]">
            <Share2Icon className="size-5" />
            Share code with Contact
          </button>
        </div>
      </div>
    </div>
  );
}
