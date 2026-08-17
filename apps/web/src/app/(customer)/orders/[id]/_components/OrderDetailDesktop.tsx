// app/(customer)/orders/[id]/_components/OrderDetailDesktop.tsx
"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { OrderDetailHeader } from "./OrderDetailHeader";
import { DeliveryCodeSection } from "./DeliveryCodeSection";
import { OrderSummaryDetails } from "./OrderSummaryDetails";
import { SupportAction } from "./SupportAction";
import type { OrderDetail, Vendor, OrderItem } from "./types";

interface OrderDetailDesktopProps {
  order: OrderDetail;
  vendor: Vendor | null;
  items: OrderItem[];
}

export function OrderDetailDesktop({
  order,
  vendor,
  items,
}: OrderDetailDesktopProps) {
  return (
    <div className="mx-auto max-w-[600px] px-4 py-8">
      {/* Back Button */}
      <Link
        href="/orders"
        className="mb-6 inline-flex items-center gap-2 font-inter text-sm font-semibold text-[#5B403C] hover:text-[#1C1B1B]"
      >
        <ChevronLeft className="size-4" />
        Back to Orders
      </Link>

      {/* Main Card */}
      <div className="overflow-hidden rounded-2xl border border-[#E5E2E1] bg-white shadow-sm">
        {/* Status Header */}
        <OrderDetailHeader
          status={order.status}
          vendorName={vendor?.name || "Vendor"}
        />

        {/* Order Content */}
        <div className="space-y-6 p-8">
          {/* Delivery Code */}
          <DeliveryCodeSection deliveryCode={order.delivery_code} />

          {/* Order Summary */}
          <OrderSummaryDetails
            items={items}
            order={order}
            vendorImage={vendor?.profile_image_url}
          />
        </div>
      </div>

      {/* Support Action */}
      <div className="mt-6">
        <SupportAction />
      </div>
    </div>
  );
}
