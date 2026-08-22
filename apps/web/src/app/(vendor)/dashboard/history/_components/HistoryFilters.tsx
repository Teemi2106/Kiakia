// app/(vendor)/history/_components/HistoryFilters.tsx
"use client";

import { Search, Download, Calendar } from "lucide-react";

interface HistoryFiltersProps {
  onSearch: (query: string) => void;
  onStatusFilter: (status: string) => void;
  onPeriodFilter: (period: string) => void;
}

export function HistoryFilters({
  onSearch,
  onStatusFilter,
  onPeriodFilter,
}: HistoryFiltersProps) {
  return (
    <div className="flex flex-col gap-4 mb-8 md:flex-row md:items-end">
      {/* Search */}
      <div className="flex-1">
        <label className="mb-2 block text-sm font-medium text-[#5B403C]">
          Search Orders
        </label>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-[#5B403C]" />
          <input
            type="text"
            placeholder="Search by Order ID or Customer..."
            onChange={(e) => onSearch(e.target.value)}
            className="w-full rounded-xl border-2 border-[#E4BEB8] bg-white py-3 pl-12 pr-4 font-inter text-sm text-[#1C1B1B] focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
          />
        </div>
      </div>

      {/* Status Filter */}
      <div className="min-w-[140px]">
        <label className="mb-2 block text-sm font-medium text-[#5B403C]">
          Status
        </label>
        <select
          onChange={(e) => onStatusFilter(e.target.value)}
          className="w-full appearance-none rounded-xl border-2 border-[#E4BEB8] bg-white px-4 py-3 font-inter text-sm text-[#1C1B1B] focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
        >
          <option value="all">All Orders</option>
          <option value="delivered">Fulfilled</option>
          <option value="cancelled">Cancelled</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Time Period */}
      <div className="min-w-[140px]">
        <label className="mb-2 block text-sm font-medium text-[#5B403C]">
          Time Period
        </label>
        <select
          onChange={(e) => onPeriodFilter(e.target.value)}
          className="w-full appearance-none rounded-xl border-2 border-[#E4BEB8] bg-white px-4 py-3 font-inter text-sm text-[#1C1B1B] focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
        >
          <option value="30">Last 30 Days</option>
          <option value="90">Last 3 Months</option>
          <option value="365">Year to Date</option>
          <option value="all">All Time</option>
        </select>
      </div>

      {/* Export Button */}
      <button className="flex h-[52px] items-center justify-center gap-2 rounded-xl bg-[#B61913] px-6 py-3 text-sm font-medium text-white transition-all hover:bg-[#9e1611] active:scale-95">
        <Download className="size-5" />
        Export CSV
      </button>
    </div>
  );
}
