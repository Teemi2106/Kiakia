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

// The order lifecycle (packages/domain/src/order-state-machine.ts) has nine
// non-terminal statuses, not two — this page only ever had two buckets to
// put them in, so every status besides the literal "in_transit"/"preparing"
// (placed, accepted, ready_for_pickup, rider_assigned, picked_up, arrived)
// used to fall through and render in NEITHER column, making an order that
// was very much active look like there were no active orders at all.
// Bucketed by whether a rider is actually involved yet: pre-rider statuses
// go to "Preparing" (kitchen-side, links to the plain order detail page —
// see PreparingOrder.tsx), rider-assigned-onward statuses go to "In
// transit" (links to the live tracking map — see FeaturedOrder.tsx).
const PREPARING_STATUSES = new Set(["placed", "accepted", "preparing", "ready_for_pickup"]);
const IN_TRANSIT_STATUSES = new Set(["rider_assigned", "picked_up", "in_transit", "arrived"]);

export function OrdersList({ orders, vendors }: OrdersListProps) {
  const getVendorName = (id: string) =>
    vendors?.find((v) => v.id === id)?.name ?? "Vendor";

  const inTransit = orders.filter((o) => IN_TRANSIT_STATUSES.has(o.status));
  const preparing = orders.filter((o) => PREPARING_STATUSES.has(o.status));

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
                    vendors?.find((v) => v.id === order.vendor_id)?.logo_url
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
                    vendors?.find((v) => v.id === order.vendor_id)?.logo_url
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
              vendors?.find((v) => v.id === order.vendor_id)?.logo_url
            }
          />
        ))}
      </div>
    </div>
  );
}
