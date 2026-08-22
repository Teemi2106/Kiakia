// app/(vendor)/earnings/_components/PayoutHistory.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Download } from "lucide-react";
import type { Payout } from "./types";

interface PayoutHistoryProps {
  payouts: Payout[];
}

export function PayoutHistory({ payouts }: PayoutHistoryProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "credit":
        return "bg-[rgba(23,106,34,0.1)] text-[#176A22]";
      default:
        return "bg-[rgba(147,75,0,0.1)] text-[#934B00]";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "credit":
        return "Success";
      default:
        return "Pending";
    }
  };

  const getEntryTypeLabel = (entryType: string) => {
    switch (entryType) {
      case "payout":
        return "Payout";
      case "refund":
        return "Refund";
      case "adjustment":
        return "Adjustment";
      default:
        return entryType
          .replace(/_/g, " ")
          .replace(/\b\w/g, (l) => l.toUpperCase());
    }
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-[#E4BEB8] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#E4BEB8] px-6 py-5">
        <h4 className="font-sora text-xl font-bold text-[#1C1B1B]">
          Payout History
        </h4>
        <button className="flex items-center gap-1 text-sm font-medium text-[#B61913] hover:underline">
          <Download className="size-4" />
          Download CSV
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-[#F6F3F2]">
            <tr>
              <th className="px-6 py-4 text-sm font-medium text-[#5B403C]">
                Reference
              </th>
              <th className="px-6 py-4 text-sm font-medium text-[#5B403C]">
                Date
              </th>
              <th className="px-6 py-4 text-sm font-medium text-[#5B403C]">
                Type
              </th>
              <th className="px-6 py-4 text-sm font-medium text-[#5B403C]">
                Amount
              </th>
              <th className="px-6 py-4 text-sm font-medium text-[#5B403C]">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(228,190,184,0.3)]">
            {payouts.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-12 text-center text-[#5B403C]"
                >
                  No payouts yet
                </td>
              </tr>
            ) : (
              payouts.map((payout) => (
                <tr
                  key={payout.id}
                  className="transition-colors hover:bg-[#F6F3F2]"
                >
                  <td className="px-6 py-4 text-sm font-bold text-[#1C1B1B]">
                    #{payout.id.slice(0, 8).toUpperCase()}
                  </td>
                  <td className="px-6 py-4 text-sm text-[#5B403C]">
                    {new Date(payout.created_at).toLocaleDateString("en-NG", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-6 py-4 text-sm text-[#5B403C]">
                    {getEntryTypeLabel(payout.entry_type)}
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-[#B61913]">
                    {formatNaira(koboOf(payout.amount_kobo))}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusColor(payout.direction)}`}
                    >
                      {getStatusLabel(payout.direction)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {payouts.length > 0 && (
        <div className="border-t border-[#E4BEB8] bg-[#F6F3F2] px-6 py-4 text-center">
          <button className="text-sm font-medium text-[#5B403C] transition-colors hover:text-[#B61913]">
            View All Transactions
          </button>
        </div>
      )}
    </div>
  );
}
