// app/(vendor)/dashboard/_components/DashboardDesktop.tsx
"use client";

import { StatsCards } from "./StatsCards";
import { IncomingOrders } from "./IncomingOrders";
import { SalesChart } from "./SalesChart";
import { ChartBar } from "lucide-react";
import type { Vendor, Order } from "./types";

interface DashboardDesktopProps {
  vendor: Vendor;
  activeCount: number;
  orders: Order[];
}

export function DashboardDesktop({
  vendor,
  activeCount,
  orders,
}: DashboardDesktopProps) {
  return (
    <div className="p-4 md:p-6 space-y-8">
      {/* Summary Cards Bento Grid */}
      <StatsCards activeCount={activeCount} variant="desktop" />

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

          <IncomingOrders orders={orders} variant="desktop" />
        </section>

        {/* Quick Sales Snapshot */}
        <aside className="lg:col-span-4 space-y-6">
          <div className="h-full rounded-2xl border border-[#E4BEB8] bg-[#F6F3F2] p-6">
            <h3 className="mb-6 font-inter text-sm font-semibold uppercase tracking-wider text-[#5B403C]">
              Quick Sales Snapshot
            </h3>

            <SalesChart />

            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-[rgba(228,190,184,0.3)] py-3">
                <div>
                  <p className="text-sm text-[#5B403C]">Top Selling</p>
                  <p className="font-bold text-[#1C1B1B]">Party Jollof</p>
                </div>
                <span className="font-bold text-[#176A22]">+12%</span>
              </div>

              <div className="flex items-center justify-between border-b border-[rgba(228,190,184,0.3)] py-3">
                <div>
                  <p className="text-sm text-[#5B403C]">New Customers</p>
                  <p className="font-bold text-[#1C1B1B]">14 Today</p>
                </div>
                <span className="font-bold text-[#176A22]">+5%</span>
              </div>

              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm text-[#5B403C]">Refund Rate</p>
                  <p className="font-bold text-[#1C1B1B]">0.2%</p>
                </div>
                <span className="font-bold text-[#5B403C]">Stable</span>
              </div>
            </div>

            <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#934B00] py-3 font-bold text-white transition-all hover:brightness-110">
              <ChartBar className="size-4" /> View Detailed Reports
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
