// app/(vendor)/dashboard/_components/DashboardMobile.tsx
"use client";

import { StatsCards } from "./StatsCards";
import { IncomingOrders } from "./IncomingOrders";
import { KitchenStatus } from "./KitchenStatus";
import type { Vendor, Order } from "./types";

interface DashboardMobileProps {
  vendor: Vendor;
  activeCount: number;
  orders: Order[];
}

export function DashboardMobile({
  vendor,
  activeCount,
  orders,
}: DashboardMobileProps) {
  return (
    <main className="w-full px-4 pb-24 pt-6 overflow-x-hidden">
      {/* Today's Overview */}
      <section className="mb-10">
        <h2 className="mb-6 flex items-center gap-2 font-sora text-2xl font-semibold text-[#1C1B1B]">
          Today's Overview
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#358439]" />
        </h2>
        <StatsCards activeCount={activeCount} variant="mobile" />
      </section>

      {/* Incoming Orders */}
      <section className="mb-10">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
            Incoming Orders
          </h2>
          <button className="flex items-center gap-1 font-inter text-sm font-medium text-[#B61913] hover:underline">
            View History
            <span className="text-sm">→</span>
          </button>
        </div>
        <IncomingOrders orders={orders} variant="mobile" />
      </section>

      {/* Kitchen Status */}
      <section>
        <h2 className="mb-6 font-sora text-2xl font-semibold text-[#1C1B1B]">
          Kitchen Status
        </h2>
        <KitchenStatus />
      </section>
    </main>
  );
}
