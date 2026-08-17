// app/(customer)/orders/_components/OrdersList.tsx
"use client";

import { Clock } from "lucide-react";
import { FeaturedOrder } from "./FeaturedOrder";
import { PreparingOrder } from "./PreparingOrder";
import { MobileOrderCard } from "./MobileOrderCard";
import type { Order, Vendor } from "./types";

interface OrdersListProps {
  orders: Order[];
  vendors: Vendor[];
}

export function OrdersList({ orders, vendors }: OrdersListProps) {
  const getVendorName = (id: string) =>
    vendors?.find((v) => v.id === id)?.name ?? "Vendor";

  // Split orders by status - using correct OrderStatus values
  const inTransit = orders.filter((o) => o.status === "in_transit"); // Changed from "out_for_delivery"
  const preparing = orders.filter((o) => o.status === "preparing");

  return (
    <div className="space-y-8">
      {/* Desktop Layout */}
      <div className="hidden lg:block">
        <div className="grid grid-cols-3 gap-6">
          {/* Left Column - In Transit Orders (2/3 width) */}
          <div className="col-span-2 space-y-6">
            {inTransit.length > 0 ? (
              inTransit.map((order) => (
                <FeaturedOrder
                  key={order.id}
                  order={order}
                  vendorName={getVendorName(order.vendor_id)}
                  vendorProfileImageUrl={
                    vendors?.find((v) => v.id === order.vendor_id)
                      ?.profile_image_url
                  }
                />
              ))
            ) : (
              <div className="flex h-[296px] items-center justify-center rounded-2xl border border-dashed border-[#E5E2E1] bg-[#FCF9F8]">
                <p className="font-inter text-sm text-[#5B403C]">
                  No orders in transit
                </p>
              </div>
            )}
          </div>

          {/* Right Column - Preparing Orders (1/3 width) */}
          <div className="col-span-1 space-y-6">
            {preparing.length > 0 ? (
              preparing.map((order) => (
                <PreparingOrder
                  key={order.id}
                  order={order}
                  vendorName={getVendorName(order.vendor_id)}
                  vendorProfileImageUrl={
                    vendors?.find((v) => v.id === order.vendor_id)
                      ?.profile_image_url
                  }
                />
              ))
            ) : (
              <div className="flex h-[296px] items-center justify-center rounded-2xl border border-dashed border-[#E5E2E1] bg-[#FCF9F8]">
                <p className="font-inter text-sm text-[#5B403C]">
                  No orders preparing
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Layout */}
      <div className="space-y-4 pb-8 lg:hidden">
        {/* Mobile Header */}
        <div className="flex items-center justify-between">
          <h2 className="font-sora text-2xl font-bold text-[#1C1B1B]">
            Active Orders
          </h2>
          <button className="rounded-full bg-[#F0EDED] p-3 hover:bg-[#e5e2e2]">
            <Clock className="size-4 text-[#5B403C]" />
          </button>
        </div>

        {orders.map((order) => (
          <MobileOrderCard
            key={order.id}
            order={order}
            vendorName={getVendorName(order.vendor_id)}
            vendorProfileImageUrl={
              vendors?.find((v) => v.id === order.vendor_id)?.profile_image_url
            }
          />
        ))}
      </div>
    </div>
  );
}
