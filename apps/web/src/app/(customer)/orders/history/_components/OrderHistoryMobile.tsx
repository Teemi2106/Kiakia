// app/(customer)/orders/history/_components/OrderHistoryMobile.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { OrderStatusBadge } from "@kiakia/ui";
import { Filter, X, ForkKnifeCrossedIcon, RefreshCcwIcon } from "lucide-react";
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

interface OrderHistoryMobileProps {
  orders: Order[];
  vendors: Vendor[];
}

type FilterType = "all" | "delivered" | "cancelled" | "rejected";

export function OrderHistoryMobile({
  orders,
  vendors,
}: OrderHistoryMobileProps) {
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  const getVendorName = (id: string) =>
    vendors?.find((v) => v.id === id)?.name ?? "Vendor";

  const getStatusColor = (status: string) => {
    switch (status) {
      case "delivered":
        return "bg-[#E8F5E9] text-[#1B5E20]";
      case "cancelled_by_customer":
      case "cancelled_by_platform":
        return "bg-[#FFEBEE] text-[#B71C1C]";
      case "rejected_by_vendor":
        return "bg-[#FFEBEE] text-[#B71C1C]";
      default:
        return "bg-[#FFF3E0] text-[#E65100]";
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

  const getFilterLabel = (filter: FilterType) => {
    switch (filter) {
      case "all":
        return "All Orders";
      case "delivered":
        return "Delivered";
      case "cancelled":
        return "Cancelled";
      case "rejected":
        return "Rejected";
    }
  };

  const filters: Array<{ label: string; value: FilterType }> = [
    { label: "All Orders", value: "all" },
    { label: "Delivered", value: "delivered" },
    { label: "Cancelled", value: "cancelled" },
    { label: "Rejected", value: "rejected" },
  ];

  const handleFilterSelect = (filter: FilterType) => {
    setActiveFilter(filter);
    setShowFilterDropdown(false);
  };

  const clearFilter = () => {
    setActiveFilter("all");
    setShowFilterDropdown(false);
  };

  return (
    <div className="flex min-h-screen flex-col pt-30 bg-[#FCF9F8]">
      {/* Page Header - No top nav since it's in the layout */}
      <div className="flex items-center justify-between px-4 pt-6 pb-4">
        <div>
          <h1 className="font-sora text-2xl font-bold text-[#1C1B1B]">
            Order History
          </h1>
          {activeFilter !== "all" && (
            <p className="font-inter text-xs text-[#B61913]">
              Filtered by: {getFilterLabel(activeFilter)}
            </p>
          )}
        </div>
        <div className="relative">
          <button
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            className="flex items-center gap-1 rounded-lg bg-[#F0EDED] px-3 py-2 font-inter text-sm font-semibold text-[#5B403C]"
          >
            <Filter className="size-4" />
            Filter
            {activeFilter !== "all" && (
              <span className="ml-1 rounded-full bg-[#B61913] px-1.5 py-0.5 text-[10px] text-white">
                1
              </span>
            )}
          </button>

          {/* Filter Dropdown */}
          {showFilterDropdown && (
            <div className="absolute right-0 top-full mt-2 z-20 min-w-[180px] overflow-hidden rounded-xl border border-[#E4BEB8] bg-white shadow-lg">
              {filters.map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => handleFilterSelect(filter.value)}
                  className={`flex w-full items-center justify-between px-4 py-3 text-left font-inter text-sm transition-colors hover:bg-[#FCF9F8] ${
                    activeFilter === filter.value
                      ? "bg-[#F6F3F2] font-semibold text-[#B61913]"
                      : "text-[#1C1B1B]"
                  }`}
                >
                  {filter.label}
                  {activeFilter === filter.value && (
                    <span className="h-2 w-2 rounded-full bg-[#B61913]" />
                  )}
                </button>
              ))}
              {activeFilter !== "all" && (
                <button
                  onClick={clearFilter}
                  className="flex w-full items-center gap-2 border-t border-[#E4BEB8] px-4 py-3 text-left font-inter text-sm text-[#5B403C] hover:bg-[#FCF9F8]"
                >
                  <X className="size-3" />
                  Clear filter
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Orders List */}
      <div className="flex-1 space-y-4 px-4 pb-8">
        {filteredOrders.length === 0 ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-[#E4BEB8] bg-white">
            <p className="font-inter text-sm text-[#5B403C]">
              No{" "}
              {activeFilter !== "all"
                ? getFilterLabel(activeFilter).toLowerCase()
                : ""}{" "}
              orders found
            </p>
          </div>
        ) : (
          filteredOrders.map((order) => {
            const statusColor = getStatusColor(order.status);
            const statusLabel = getStatusLabel(order.status);
            const isCancelled =
              order.status === "cancelled_by_customer" ||
              order.status === "cancelled_by_platform";

            return (
              <div
                key={order.id}
                className={`overflow-hidden rounded-xl border border-[#E4BEB8] bg-white shadow-sm ${isCancelled ? "opacity-80" : ""}`}
              >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-[#E5E2E1] p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 overflow-hidden rounded-lg bg-[#F0EDED]">
                      <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1] text-xl">
                        {/* {Profile_Image ? (  uncomment when you have the vendor profile image URL
                          <Image src={Profile_Image || ""} alt={vendorName} />
                        ) : (
                          <span className="text-6xl">
                            <ForkKnifeCrossedIcon />
                          </span>
                        )} */}
                        <ForkKnifeCrossedIcon />
                      </div>
                    </div>
                    <div>
                      <h3 className="font-inter text-sm font-bold text-[#1C1B1B]">
                        {getVendorName(order.vendor_id)}
                      </h3>
                      <p className="font-inter text-xs text-[#5B403C]">
                        {order.code} •{" "}
                        {new Date(order.created_at).toLocaleDateString(
                          "en-NG",
                          {
                            month: "short",
                            day: "numeric",
                          },
                        )}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColor}`}
                  >
                    {statusLabel}
                  </span>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between bg-[#FCF9F8] p-4">
                  <div>
                    <p className="font-inter text-sm text-[#1C1B1B]">
                      Total:{" "}
                      <span className="font-bold">
                        {formatNaira(koboOf(order.total_kobo))}
                      </span>
                    </p>
                    <p className="font-inter text-xs text-[#5B403C]">3 items</p>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href={`/orders/${order.id}`}
                      className="rounded-lg border border-[#906F6B] px-4 py-2 font-inter text-sm font-semibold text-[#1C1B1B]"
                    >
                      Details
                    </Link>
                    <button
                      className={`flex items-center gap-1 rounded-lg px-4 py-2 font-inter text-sm font-semibold text-white shadow-sm ${
                        isCancelled
                          ? "bg-[#FE8E27] text-[#653200]"
                          : "bg-[#B61913]"
                      }`}
                    >
                      <RefreshCcwIcon className="size-4" />
                      Reorder
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Load More */}
        {filteredOrders.length > 0 && (
          <div className="flex justify-center py-6">
            <button className="h-8 w-8 rounded-full border-2 border-[#E4BEB8]"></button>
          </div>
        )}
      </div>
    </div>
  );
}
