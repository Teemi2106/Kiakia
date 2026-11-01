// app/(vendor)/history/_components/HistoryTable.tsx
"use client";

import { formatNaira, koboOf, type OrderStatus } from "@kiakia/domain";
import { OrderStatusBadge } from "@kiakia/ui";
import { MoreVertical } from "lucide-react";
import type { Order } from "./types";

interface HistoryTableProps {
  orders: Order[];
}

export function HistoryTable({ orders }: HistoryTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-kk-line bg-kk-sand">
            <th className="px-6 py-4 text-sm font-medium text-kk-cocoa">
              Date
            </th>
            <th className="px-6 py-4 text-sm font-medium text-kk-cocoa">
              Order ID
            </th>
            <th className="px-6 py-4 text-sm font-medium text-kk-cocoa">
              Customer
            </th>
            <th className="px-6 py-4 text-sm font-medium text-kk-cocoa">
              Items
            </th>
            <th className="px-6 py-4 text-sm font-medium text-kk-cocoa text-right">
              Total
            </th>
            <th className="px-6 py-4 text-sm font-medium text-kk-cocoa">
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
              <td className="whitespace-nowrap px-6 py-5 text-sm text-kk-ink">
                {new Date(order.created_at).toLocaleDateString("en-NG", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                <span className="ml-1 text-xs text-kk-cocoa/60">
                  {new Date(order.created_at).toLocaleTimeString("en-NG", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </td>
              <td className="px-6 py-5 text-sm font-medium text-kk-red-ink">
                {order.code}
              </td>
              <td className="whitespace-nowrap px-6 py-5 text-sm font-medium text-kk-ink">
                {order.customer_name || "Customer"}
              </td>
              <td className="px-6 py-5 text-sm text-kk-cocoa">
                {order.items || "Order items"}
              </td>
              <td className="whitespace-nowrap px-6 py-5 text-right text-sm font-bold text-kk-ink">
                {formatNaira(koboOf(order.total_kobo))}
              </td>
              <td className="px-6 py-5">
                <OrderStatusBadge status={order.status as OrderStatus} />
              </td>
              <td className="px-6 py-5 text-right">
                <button
                  type="button"
                  aria-label="More actions"
                  className="rounded-lg p-2 transition-colors hover:bg-kk-fill"
                >
                  <MoreVertical className="size-5 text-kk-cocoa" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
