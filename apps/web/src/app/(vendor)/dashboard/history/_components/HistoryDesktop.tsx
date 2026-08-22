// app/(vendor)/history/_components/HistoryDesktop.tsx
"use client";

import { useState } from "react";
import { HistoryStats } from "./HistoryStats";
import { HistoryFilters } from "./HistoryFilters";
import { HistoryTable } from "./HistoryTable";
import { HistoryPagination } from "./HistoryPagination";
import type { Order } from "./types";

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
        onSearch={setSearchQuery}
        onStatusFilter={setStatusFilter}
        onPeriodFilter={setPeriodFilter}
      />

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-[#E4BEB8] bg-white shadow-sm">
        {filteredOrders.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-[#5B403C]">No orders found</p>
          </div>
        ) : (
          <HistoryTable orders={filteredOrders} />
        )}

        <HistoryPagination total={filteredOrders.length} />
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
          <button className="rounded-xl border-2 border-[#934B00] px-6 py-3 text-sm font-medium text-[#934B00] transition-colors hover:bg-[rgba(147,75,0,0.05)]">
            Read Guidelines
          </button>
          <button className="rounded-xl bg-[#B61913] px-6 py-3 text-sm font-medium text-white shadow-lg transition-all hover:bg-[#9e1611] active:scale-95">
            Open Ticket
          </button>
        </div>
      </div>
    </div>
  );
}
