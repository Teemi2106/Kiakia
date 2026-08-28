// app/(customer)/orders/history/_components/OrderHistoryDesktop.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import type { OrderStatus } from "@kiakia/domain";
import { OrderStatusBadge } from "@kiakia/ui";
import Link from "next/link";
import Image from "next/image";
import {
  ForkKnifeCrossedIcon,
  BoxIcon,
  CurrencyIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";

const PAGE_SIZE = 10;

interface Order {
  id: string;
  code: string;
  status: string;
  total_kobo: number;
  vendor_id: string;
  created_at: string;
  item_count: number;
}

interface Vendor {
  id: string;
  name: string;
  logo_url?: string | null;
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
  const [page, setPage] = useState(1);

  const getVendorName = (id: string) =>
    vendors?.find((v) => v.id === id)?.name ?? "Vendor";
  const getVendorLogo = (id: string) => vendors?.find((v) => v.id === id)?.logo_url;

  const selectFilter = (filter: FilterType) => {
    setActiveFilter(filter);
    setPage(1);
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

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageOrders = filteredOrders.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

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
              type="button"
              onClick={() => selectFilter(filter.value)}
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
          {pageOrders.map((order) => {
            const logoUrl = getVendorLogo(order.vendor_id);

            return (
              <div
                key={order.id}
                className="flex items-center justify-between rounded-2xl border border-[#E4BEB8] bg-[#FCF9F8] p-4 shadow-sm"
              >
                {/* Left Section */}
                <div className="flex items-center gap-4">
                  {/* Image */}
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[#F0EDED]">
                    {logoUrl ? (
                      <Image
                        src={logoUrl}
                        alt={getVendorName(order.vendor_id)}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1] text-[#5B403C]/40">
                        <ForkKnifeCrossedIcon className="size-6" />
                      </div>
                    )}
                  </div>

                  {/* Details */}
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
                        {getVendorName(order.vendor_id)}
                      </h3>
                      <OrderStatusBadge status={order.status as OrderStatus} />
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
                        <BoxIcon className="size-3 text-[#5B403C]" />{" "}
                        {order.item_count} {order.item_count === 1 ? "item" : "items"}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-[#5B403C]">
                        <CurrencyIcon className="size-3 text-[#5B403C]" />{" "}
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
                  <button
                    type="button"
                    className="rounded-xl bg-[#B61913] px-6 py-2 font-inter text-sm font-semibold text-white shadow-sm hover:bg-[#9e1611]"
                  >
                    Reorder
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination — real, derived from the actual filtered result count
          (at most 50 orders are ever loaded per page.tsx's own `.limit(50)`),
          never a placeholder page count. */}
      {filteredOrders.length > PAGE_SIZE && (
        <div className="mt-8 flex justify-center">
          <nav className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-40 hover:enabled:bg-[#F0EDED]"
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4 text-[#5B403C]" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                className={`flex h-10 w-10 items-center justify-center rounded-full font-inter text-sm font-semibold ${
                  pageNumber === currentPage
                    ? "bg-[#B61913] text-white"
                    : "text-[#5B403C] hover:bg-[#F0EDED]"
                }`}
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-40 hover:enabled:bg-[#F0EDED]"
              aria-label="Next page"
            >
              <ChevronRight className="size-4 text-[#5B403C]" />
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}
