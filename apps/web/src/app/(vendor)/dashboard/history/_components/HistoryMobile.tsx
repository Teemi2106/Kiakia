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
                ? "bg-kk-red text-white shadow-sm"
                : "bg-kk-fill text-kk-cocoa hover:bg-kk-hair"
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter("week")}
            className={`rounded-full px-6 py-2.5 text-sm font-medium whitespace-nowrap transition-all active:scale-95 ${
              activeFilter === "week"
                ? "bg-kk-red text-white shadow-sm"
                : "bg-kk-fill text-kk-cocoa hover:bg-kk-hair"
            }`}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter("month")}
            className={`rounded-full px-6 py-2.5 text-sm font-medium whitespace-nowrap transition-all active:scale-95 ${
              activeFilter === "month"
                ? "bg-kk-red text-white shadow-sm"
                : "bg-kk-fill text-kk-cocoa hover:bg-kk-hair"
            }`}
          >
            Month
          </button>
          <div className="ml-auto flex items-center gap-2 rounded-xl border border-kk-line bg-kk-card px-4 py-2">
            <Calendar className="size-4 text-kk-cocoa" />
            <span className="text-sm text-kk-cocoa">Custom Range</span>
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
        <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-kk-cocoa" />
        <input
          type="text"
          value={searchQuery}
          placeholder="Search orders..."
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-xl border border-kk-line bg-kk-card py-3 pl-12 pr-4 text-sm text-kk-ink transition-colors focus:border-kk-red focus:outline-none focus:ring-2 focus:ring-kk-red-ink/20"
        />
      </div>

      {/* Orders List */}
      <div className="space-y-4">
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-kk-line bg-kk-card px-6 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-kk-sand text-kk-red-ink">
              <PackageSearch className="size-6" />
            </div>
            <p className="font-sora text-base font-bold text-kk-ink">
              No orders found
            </p>
            <p className="max-w-xs text-sm text-kk-cocoa">
              Try a different search term, or clear it to see all past orders.
            </p>
            {searchQuery !== "" && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="mt-1 rounded-xl border-2 border-kk-orange-ink px-5 py-2.5 text-sm font-medium text-kk-orange-ink transition-colors hover:bg-[rgba(147,75,0,0.05)]"
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
            className="font-inter text-sm font-bold text-kk-red-ink/50 cursor-not-allowed"
          >
            Load Older History (coming soon)
          </button>
        </div>
      )}
    </div>
  );
}
