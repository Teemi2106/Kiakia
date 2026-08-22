// app/(vendor)/history/_components/HistoryTable.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { OrderStatusBadge } from "@kiakia/ui";
import { MoreVertical } from "lucide-react";
import type { Order } from "./types";

interface HistoryTableProps {
  orders: Order[];
}

export function HistoryTable({ orders }: HistoryTableProps) {
  const getStatusLabel = (status: string) => {
    switch (status) {
      case "delivered":
        return "Fulfilled";
      case "cancelled_by_customer":
      case "cancelled_by_platform":
        return "Cancelled";
      case "rejected_by_vendor":
        return "Rejected";
      default:
        return status;
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[#E4BEB8] bg-[#F6F3F2]">
            <th className="px-6 py-4 text-sm font-medium text-[#5B403C]">
              Date
            </th>
            <th className="px-6 py-4 text-sm font-medium text-[#5B403C]">
              Order ID
            </th>
            <th className="px-6 py-4 text-sm font-medium text-[#5B403C]">
              Customer
            </th>
            <th className="px-6 py-4 text-sm font-medium text-[#5B403C]">
              Items
            </th>
            <th className="px-6 py-4 text-sm font-medium text-[#5B403C] text-right">
              Total
            </th>
            <th className="px-6 py-4 text-sm font-medium text-[#5B403C]">
              Status
            </th>
            <th className="px-6 py-4"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgba(228,190,184,0.3)]">
          {orders.map((order) => (
            <tr
              key={order.id}
              className="transition-colors hover:bg-[rgba(246,243,242,0.5)]"
            >
              <td className="whitespace-nowrap px-6 py-5 text-sm text-[#1C1B1B]">
                {new Date(order.created_at).toLocaleDateString("en-NG", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                <span className="ml-1 text-xs text-[#5B403C]/60">
                  {new Date(order.created_at).toLocaleTimeString("en-NG", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </td>
              <td className="px-6 py-5 text-sm font-medium text-[#B61913]">
                {order.code}
              </td>
              <td className="whitespace-nowrap px-6 py-5 text-sm font-medium text-[#1C1B1B]">
                {order.customer_name || "Customer"}
              </td>
              <td className="px-6 py-5 text-sm text-[#5B403C]">
                {order.items || "Order items"}
              </td>
              <td className="whitespace-nowrap px-6 py-5 text-right text-sm font-bold text-[#1C1B1B]">
                {formatNaira(koboOf(order.total_kobo))}
              </td>
              <td className="px-6 py-5">
                <OrderStatusBadge status={order.status as any} />
              </td>
              <td className="px-6 py-5 text-right">
                <button className="rounded-lg p-2 transition-colors hover:bg-[#F0EDED]">
                  <MoreVertical className="size-5 text-[#5B403C]" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
