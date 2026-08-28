// app/(vendor)/dashboard/_components/DashboardDesktop.tsx
"use client";

import { StatsCards } from "./StatsCards";
import { IncomingOrders } from "./IncomingOrders";
import { SalesChart } from "./SalesChart";
import { ChartBar, Inbox } from "lucide-react";
import Link from "next/link";
import type { Vendor, Order, SalesDataPoint } from "./types";

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
            <h3 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
              Incoming Orders
            </h3>
            <div className="flex items-center gap-2 rounded-full bg-[rgba(218,53,41,0.1)] px-3 py-1.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#B61913]" />
              <span className="font-inter text-xs font-medium leading-4 text-[#B61913]">
                Live Updates
              </span>
            </div>
          </div>

          {orders.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[#E4BEB8] bg-white p-10 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-[#FCF9F8] text-[#5B403C]">
                <Inbox className="size-6" />
              </span>
              <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
                No incoming orders right now
              </p>
              <p className="max-w-sm text-sm text-[#5B403C]">
                New orders will show up here the moment a customer checks out.
              </p>
            </div>
          ) : (
            <IncomingOrders orders={orders} variant="desktop" />
          )}
        </section>

        {/* Quick Sales Snapshot */}
        <aside className="lg:col-span-4 space-y-6">
          <div className="h-full rounded-2xl border border-[#E4BEB8] bg-[#F6F3F2] p-6">
            <h3 className="mb-6 font-inter text-sm font-semibold uppercase tracking-wider text-[#5B403C]">
              Sales — Last 7 Days
            </h3>

            <SalesChart data={salesData} />

            <Link
              href="/dashboard/earnings"
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#934B00] py-3 font-bold text-white transition-all hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#934B00]/40"
            >
              <ChartBar className="size-4" /> View Detailed Reports
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
