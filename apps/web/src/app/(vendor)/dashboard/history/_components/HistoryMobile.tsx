// app/(vendor)/history/_components/HistoryMobile.tsx
"use client";

import { useState } from "react";
import { Calendar, PackageSearch, Search } from "lucide-react";
import { HistoryStats } from "./HistoryStats";
import { HistoryCard } from "./HistoryCard";
import type { Order } from "./types";

interface HistoryMobileProps {
  orders: Order[];
  fulfilled: number;
  cancelled: number;
  disputed: number;
}

export function HistoryMobile({
  orders,
  fulfilled,
  cancelled,
  disputed,
}: HistoryMobileProps) {
  const [activeFilter, setActiveFilter] = useState("today");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredOrders = orders.filter((order) => {
    return order.code.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div className="p-4 pb-24">
      {/* Filter Tabs */}
      <section className="mb-6">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <button
            type="button"
            onClick={() => setActiveFilter("today")}
            className={`rounded-full px-6 py-2.5 text-sm font-medium whitespace-nowrap transition-all active:scale-95 ${
              activeFilter === "today"
                ? "bg-[#B61913] text-white shadow-sm"
                : "bg-[#F0EDED] text-[#5B403C] hover:bg-[#E5E2E1]"
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter("week")}
            className={`rounded-full px-6 py-2.5 text-sm font-medium whitespace-nowrap transition-all active:scale-95 ${
              activeFilter === "week"
                ? "bg-[#B61913] text-white shadow-sm"
                : "bg-[#F0EDED] text-[#5B403C] hover:bg-[#E5E2E1]"
            }`}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter("month")}
            className={`rounded-full px-6 py-2.5 text-sm font-medium whitespace-nowrap transition-all active:scale-95 ${
              activeFilter === "month"
                ? "bg-[#B61913] text-white shadow-sm"
                : "bg-[#F0EDED] text-[#5B403C] hover:bg-[#E5E2E1]"
            }`}
          >
            Month
          </button>
          <div className="ml-auto flex items-center gap-2 rounded-xl border border-[#E4BEB8] bg-white px-4 py-2">
            <Calendar className="size-4 text-[#5B403C]" />
            <span className="text-sm text-[#5B403C]">Custom Range</span>
          </div>
        </div>
      </section>

      {/* Stats */}
      <HistoryStats
        fulfilled={fulfilled}
        cancelled={cancelled}
        disputed={disputed}
      />

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#5B403C]" />
        <input
          type="text"
          value={searchQuery}
          placeholder="Search orders..."
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-xl border border-[#E4BEB8] bg-white py-3 pl-12 pr-4 text-sm text-[#1C1B1B] transition-colors focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
        />
      </div>

      {/* Orders List */}
      <div className="space-y-4">
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[#E4BEB8] bg-white px-6 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-[#F6F3F2] text-[#B61913]">
              <PackageSearch className="size-6" />
            </div>
            <p className="font-sora text-base font-bold text-[#1C1B1B]">
              No orders found
            </p>
            <p className="max-w-xs text-sm text-[#5B403C]">
              Try a different search term, or clear it to see all past orders.
            </p>
            {searchQuery !== "" && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="mt-1 rounded-xl border-2 border-[#934B00] px-5 py-2.5 text-sm font-medium text-[#934B00] transition-colors hover:bg-[rgba(147,75,0,0.05)]"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          filteredOrders.map((order) => (
            <HistoryCard key={order.id} order={order} />
          ))
        )}
      </div>

      {/* Load More */}
      {filteredOrders.length > 0 && (
        <div className="py-8 text-center">
          <button
            type="button"
            disabled
            title="Older history isn't paginated yet in this release"
            aria-disabled="true"
            className="font-inter text-sm font-bold text-[#B61913]/50 cursor-not-allowed"
          >
            Load Older History (coming soon)
          </button>
        </div>
      )}
    </div>
  );
}
