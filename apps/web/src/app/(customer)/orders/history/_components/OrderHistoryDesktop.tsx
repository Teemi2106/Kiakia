// app/(customer)/orders/history/_components/OrderHistoryDesktop.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { OrderStatusBadge } from "@kiakia/ui";
import Link from "next/link";
import { useState } from "react";

interface Order {
  id: string;
  code: string;
  status: string;
  total_kobo: number;
  vendor_id: string;
  created_at: string;
}

interface Vendor {
  id: string;
  name: string;
}

interface OrderHistoryDesktopProps {
  orders: Order[];
  vendors: Vendor[];
}

type FilterType = "all" | "delivered" | "cancelled" | "rejected";

export function OrderHistoryDesktop({
  orders,
  vendors,
}: OrderHistoryDesktopProps) {
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");

  const getVendorName = (id: string) =>
    vendors?.find((v) => v.id === id)?.name ?? "Vendor";

  const getStatusColor = (status: string) => {
    switch (status) {
      case "delivered":
        return "bg-[rgba(23,106,34,0.1)] text-[#176A22]";
      case "cancelled_by_customer":
      case "cancelled_by_platform":
        return "bg-[rgba(186,26,26,0.1)] text-[#BA1A1A]";
      case "rejected_by_vendor":
        return "bg-[rgba(186,26,26,0.1)] text-[#BA1A1A]";
      default:
        return "bg-[rgba(254,142,39,0.1)] text-[#934B00]";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "delivered":
        return "Delivered";
      case "cancelled_by_customer":
        return "Cancelled";
      case "cancelled_by_platform":
        return "Cancelled";
      case "rejected_by_vendor":
        return "Rejected";
      default:
        return status;
    }
  };

  // Filter logic
  const getFilteredOrders = () => {
    switch (activeFilter) {
      case "delivered":
        return orders.filter((o) => o.status === "delivered");
      case "cancelled":
        return orders.filter(
          (o) =>
            o.status === "cancelled_by_customer" ||
            o.status === "cancelled_by_platform",
        );
      case "rejected":
        return orders.filter((o) => o.status === "rejected_by_vendor");
      default:
        return orders;
    }
  };

  const filteredOrders = getFilteredOrders();

  const getFilterCount = (filter: FilterType) => {
    switch (filter) {
      case "delivered":
        return orders.filter((o) => o.status === "delivered").length;
      case "cancelled":
        return orders.filter(
          (o) =>
            o.status === "cancelled_by_customer" ||
            o.status === "cancelled_by_platform",
        ).length;
      case "rejected":
        return orders.filter((o) => o.status === "rejected_by_vendor").length;
      default:
        return orders.length;
    }
  };

  const filters: Array<{ label: string; value: FilterType }> = [
    { label: "All Orders", value: "all" },
    { label: "Delivered", value: "delivered" },
    { label: "Cancelled", value: "cancelled" },
    { label: "Rejected", value: "rejected" },
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-15">
      {/* Header */}
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.32px] text-[#1C1B1B]">
            Order History
          </h1>
          <p className="mt-2 font-inter text-base text-[#5B403C]">
            View all your past orders
          </p>
        </div>

        {/* Filter Options */}
        <div className="flex gap-2">
          {filters.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setActiveFilter(filter.value)}
              className={`rounded-lg border px-4 py-2 font-inter text-sm font-semibold transition-colors ${
                activeFilter === filter.value
                  ? "border-[#B61913] bg-[#B61913] text-white"
                  : "border-[#E4BEB8] bg-[#FCF9F8] text-[#1C1B1B] hover:bg-[#F0EDED]"
              }`}
            >
              {filter.label}{" "}
              <span className="ml-1 rounded-full bg-[rgba(0,0,0,0.1)] px-2 py-0.5 text-xs">
                {getFilterCount(filter.value)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Orders List */}
      {filteredOrders.length === 0 ? (
        <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-[#E4BEB8] bg-[#FCF9F8]">
          <p className="font-inter text-base text-[#5B403C]">
            No {activeFilter !== "all" ? activeFilter : ""} orders found
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => {
            const statusColor = getStatusColor(order.status);
            const statusLabel = getStatusLabel(order.status);

            return (
              <div
                key={order.id}
                className="flex items-center justify-between rounded-2xl border border-[#E4BEB8] bg-[#FCF9F8] p-4 shadow-sm"
              >
                {/* Left Section */}
                <div className="flex items-center gap-4">
                  {/* Image */}
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[#F0EDED]">
                    <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1] text-2xl text-[#5B403C]/20">
                      🍽️
                    </div>
                  </div>

                  {/* Details */}
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
                        {getVendorName(order.vendor_id)}
                      </h3>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${statusColor}`}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <p className="font-inter text-sm text-[#5B403C]">
                      {order.code} •{" "}
                      {new Date(order.created_at).toLocaleDateString("en-NG", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                    <div className="mt-1 flex items-center gap-4">
                      <span className="flex items-center gap-1 text-xs text-[#5B403C]">
                        <span className="h-3 w-3 bg-[#5B403C]" /> 3 items
                      </span>
                      <span className="flex items-center gap-1 text-xs text-[#5B403C]">
                        <span className="h-3 w-3 bg-[#5B403C]" />{" "}
                        {formatNaira(koboOf(order.total_kobo))}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                  <Link
                    href={`/orders/${order.id}`}
                    className="rounded-xl border-2 border-[#934B00] px-6 py-2 font-inter text-sm font-semibold text-[#934B00] hover:bg-[#F6F3F2]"
                  >
                    Details
                  </Link>
                  <button className="rounded-xl bg-[#B61913] px-6 py-2 font-inter text-sm font-semibold text-white shadow-sm hover:bg-[#9e1611]">
                    Reorder
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {filteredOrders.length > 0 && (
        <div className="mt-8 flex justify-center">
          <nav className="flex items-center gap-2">
            <button className="flex h-10 w-10 items-center justify-center rounded-full opacity-50">
              <span className="h-3 w-1.5 bg-[#5B403C]" />
            </button>
            <button className="flex h-10 w-10 items-center justify-center rounded-full bg-[#B61913] text-white">
              1
            </button>
            <button className="flex h-10 w-10 items-center justify-center rounded-full text-[#5B403C]">
              2
            </button>
            <button className="flex h-10 w-10 items-center justify-center rounded-full text-[#5B403C]">
              3
            </button>
            <span className="text-[#5B403C]">...</span>
            <button className="flex h-10 w-10 items-center justify-center rounded-full text-[#5B403C]">
              8
            </button>
            <button className="flex h-10 w-10 items-center justify-center rounded-full">
              <span className="h-3 w-1.5 bg-[#5B403C]" />
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}
