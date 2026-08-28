// app/(vendor)/history/_components/HistoryDesktop.tsx
"use client";

import { PackageSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { HistoryStats } from "./HistoryStats";
import { HistoryFilters } from "./HistoryFilters";
import { HistoryTable } from "./HistoryTable";
import { HistoryPagination } from "./HistoryPagination";
import type { Order } from "./types";

const PAGE_SIZE = 10;

interface HistoryDesktopProps {
  orders: Order[];
  fulfilled: number;
  cancelled: number;
  disputed: number;
}

export function HistoryDesktop({
  orders,
  fulfilled,
  cancelled,
  disputed,
}: HistoryDesktopProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("30");
  const [page, setPage] = useState(1);

  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      order.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (order.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ??
        false);

    let matchesStatus = true;
    if (statusFilter === "delivered") {
      matchesStatus = order.status === "delivered";
    } else if (statusFilter === "cancelled") {
      matchesStatus =
        order.status === "cancelled_by_customer" ||
        order.status === "cancelled_by_platform";
    } else if (statusFilter === "rejected") {
      matchesStatus = order.status === "rejected_by_vendor";
    }

    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageOrders = useMemo(
    () =>
      filteredOrders.slice(
        (currentPage - 1) * PAGE_SIZE,
        currentPage * PAGE_SIZE,
      ),
    [filteredOrders, currentPage],
  );

  const hasActiveFilters = searchQuery !== "" || statusFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setPage(1);
  };

  return (
    <div className="p-6">
      {/* Stats */}
      <HistoryStats
        fulfilled={fulfilled}
        cancelled={cancelled}
        disputed={disputed}
      />

      {/* Filters */}
      <HistoryFilters
        onSearch={(value) => {
          setSearchQuery(value);
          setPage(1);
        }}
        onStatusFilter={(value) => {
          setStatusFilter(value);
          setPage(1);
        }}
        onPeriodFilter={setPeriodFilter}
      />

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-[#E4BEB8] bg-white shadow-sm">
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-[#F6F3F2] text-[#B61913]">
              <PackageSearch className="size-6" />
            </div>
            <p className="font-sora text-base font-bold text-[#1C1B1B]">
              No orders match your filters
            </p>
            <p className="max-w-sm text-sm text-[#5B403C]">
              Try a different search term or status, or clear your filters to
              see the full history.
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-2 rounded-xl border-2 border-[#934B00] px-5 py-2.5 text-sm font-medium text-[#934B00] transition-colors hover:bg-[rgba(147,75,0,0.05)]"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <HistoryTable orders={pageOrders} />
        )}

        {filteredOrders.length > 0 && (
          <HistoryPagination
            total={filteredOrders.length}
            currentPage={currentPage}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        )}
      </div>

      {/* Support Section */}
      <div className="mt-12 grid grid-cols-1 gap-8 rounded-3xl border-2 border-dashed border-[#E4BEB8] bg-[rgba(246,243,242,0.3)] p-8 md:grid-cols-2 md:items-center">
        <div>
          <h4 className="font-sora text-2xl font-bold text-[#1C1B1B] mb-2">
            Order Resolution Center
          </h4>
          <p className="text-sm text-[#5B403C]">
            Have questions about a specific order or need to handle a refund?
            Our support team is available 24/7 for high-velocity assistance.
          </p>
        </div>
        <div className="flex justify-end gap-4">
          <button
            type="button"
            className="rounded-xl border-2 border-[#934B00] px-6 py-3 text-sm font-medium text-[#934B00] transition-colors hover:bg-[rgba(147,75,0,0.05)]"
          >
            Read Guidelines
          </button>
          <button
            type="button"
            className="rounded-xl bg-[#B61913] px-6 py-3 text-sm font-medium text-white shadow-lg transition-all hover:bg-[#9e1611] active:scale-95"
          >
            Open Ticket
          </button>
        </div>
      </div>
    </div>
  );
}
