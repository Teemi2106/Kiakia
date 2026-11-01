// app/(vendor)/dashboard/_components/DashboardMobile.tsx
"use client";

import { StatsCards } from "./StatsCards";
import { IncomingOrders } from "./IncomingOrders";
import { KitchenStatus } from "./KitchenStatus";
import { Inbox } from "lucide-react";
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
        <h2 className="mb-6 flex items-center gap-2 font-sora text-2xl font-semibold text-kk-ink">
          Today&apos;s Overview
          <span className="h-2 w-2 animate-pulse rounded-full bg-kk-green-mid" />
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
          <h2 className="font-sora text-2xl font-semibold text-kk-ink">
            Incoming Orders
          </h2>
          <Link
            href="/dashboard/history"
            className="flex items-center gap-1 font-inter text-sm font-medium text-kk-red-ink hover:underline"
          >
            View History
            <span className="text-sm">→</span>
          </Link>
        </div>
        {orders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-kk-line bg-kk-card p-8 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-kk-cream text-kk-cocoa">
              <Inbox className="size-5" />
            </span>
            <p className="font-inter text-sm font-semibold text-kk-ink">
              No incoming orders right now
            </p>
            <p className="text-xs text-kk-cocoa">
              New orders will show up here the moment a customer checks out.
            </p>
          </div>
        ) : (
          <IncomingOrders orders={orders} variant="mobile" />
        )}
      </section>

      {/* Kitchen Status */}
      <section>
        <h2 className="mb-6 font-sora text-2xl font-semibold text-kk-ink">
          Kitchen Status
        </h2>
        <KitchenStatus preparingCount={preparingCount} dispatchCount={dispatchCount} />
      </section>
    </main>
  );
}
