// app/(vendor)/dashboard/_components/DashboardMobile.tsx
"use client";

import { StatsCards } from "./StatsCards";
import { IncomingOrders } from "./IncomingOrders";
import { KitchenStatus } from "./KitchenStatus";
import Link from "next/link";
import type { Vendor, Order } from "./types";

interface DashboardMobileProps {
  vendor: Vendor;
  activeCount: number;
  preparingCount: number;
  dispatchCount: number;
  escrowKobo: number;
  availableKobo: number;
  orders: Order[];
}

export function DashboardMobile({
  activeCount,
  preparingCount,
  dispatchCount,
  escrowKobo,
  availableKobo,
  orders,
}: DashboardMobileProps) {
  return (
    <main className="w-full px-4 pb-24 pt-6 overflow-x-hidden">
      {/* Today's Overview */}
      <section className="mb-10">
        <h2 className="mb-6 flex items-center gap-2 font-sora text-2xl font-semibold text-[#1C1B1B]">
          Today&apos;s Overview
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#358439]" />
        </h2>
        <StatsCards
          activeCount={activeCount}
          escrowKobo={escrowKobo}
          availableKobo={availableKobo}
          variant="mobile"
        />
      </section>

      {/* Incoming Orders */}
      <section className="mb-10">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
            Incoming Orders
          </h2>
          <Link
            href="/dashboard/history"
            className="flex items-center gap-1 font-inter text-sm font-medium text-[#B61913] hover:underline"
          >
            View History
            <span className="text-sm">→</span>
          </Link>
        </div>
        {orders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#E4BEB8] bg-white p-6 text-center text-sm text-[#5B403C]">
            No incoming orders right now.
          </div>
        ) : (
          <IncomingOrders orders={orders} variant="mobile" />
        )}
      </section>

      {/* Kitchen Status */}
      <section>
        <h2 className="mb-6 font-sora text-2xl font-semibold text-[#1C1B1B]">
          Kitchen Status
        </h2>
        <KitchenStatus preparingCount={preparingCount} dispatchCount={dispatchCount} />
      </section>
    </main>
  );
}
