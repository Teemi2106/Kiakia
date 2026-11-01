// app/(vendor)/dashboard/_components/DashboardDesktop.tsx
"use client";

import dynamic from "next/dynamic";
import { StatsCards } from "./StatsCards";
import { IncomingOrders } from "./IncomingOrders";
import { ChartBar, Inbox } from "lucide-react";
import Link from "next/link";
import type { Vendor, Order, SalesDataPoint } from "./types";

// recharts is ~300 KB of JS that only the chart needs; loading it on demand keeps it
// out of this page's first-load bundle, so the page is interactive before the chart is.
const SalesChart = dynamic(() => import("./SalesChart").then((m) => m.SalesChart), {
  ssr: false,
  loading: () => <div className="h-48 w-full animate-pulse rounded-xl bg-kk-fill" aria-hidden="true" />,
});


interface DashboardDesktopProps {
  vendor: Vendor;
  activeCount: number;
  escrowKobo: number;
  availableKobo: number;
  orders: Order[];
  salesData: SalesDataPoint[];
}

export function DashboardDesktop({
  activeCount,
  escrowKobo,
  availableKobo,
  orders,
  salesData,
}: DashboardDesktopProps) {
  return (
    <div className="p-4 md:p-6 space-y-8">
      {/* Summary Cards Bento Grid */}
      <StatsCards
        activeCount={activeCount}
        escrowKobo={escrowKobo}
        availableKobo={availableKobo}
        variant="desktop"
      />

      {/* Middle Section: Orders Queue and Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Incoming Orders Queue */}
        <section className="lg:col-span-8 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-sora text-2xl font-semibold text-kk-ink">
              Incoming Orders
            </h3>
            <div className="flex items-center gap-2 rounded-full bg-[rgba(218,53,41,0.1)] px-3 py-1.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-kk-red" />
              <span className="font-inter text-xs font-medium leading-4 text-kk-red-ink">
                Live Updates
              </span>
            </div>
          </div>

          {orders.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-kk-line bg-kk-card p-10 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-kk-cream text-kk-cocoa">
                <Inbox className="size-6" />
              </span>
              <p className="font-inter text-sm font-semibold text-kk-ink">
                No incoming orders right now
              </p>
              <p className="max-w-sm text-sm text-kk-cocoa">
                New orders will show up here the moment a customer checks out.
              </p>
            </div>
          ) : (
            <IncomingOrders orders={orders} variant="desktop" />
          )}
        </section>

        {/* Quick Sales Snapshot */}
        <aside className="lg:col-span-4 space-y-6">
          <div className="h-full rounded-2xl border border-kk-line bg-kk-sand p-6">
            <h3 className="mb-6 font-inter text-sm font-semibold uppercase tracking-wider text-kk-cocoa">
              Sales — Last 7 Days
            </h3>

            <SalesChart data={salesData} />

            <Link
              href="/dashboard/earnings"
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#934B00] py-3 font-bold text-white transition-all hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kk-orange-ink/40"
            >
              <ChartBar className="size-4" /> View Detailed Reports
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
