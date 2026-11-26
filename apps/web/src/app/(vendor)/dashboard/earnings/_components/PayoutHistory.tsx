// app/(vendor)/earnings/_components/PayoutHistory.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Receipt } from "lucide-react";
import type { Payout } from "./types";

interface PayoutHistoryProps {
  payouts: Payout[];
}

export function PayoutHistory({ payouts }: PayoutHistoryProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "credit":
        return "bg-[rgba(23,106,34,0.1)] text-kk-green-ink";
      default:
        return "bg-[rgba(147,75,0,0.1)] text-kk-orange-ink";
    }
  };

  const getDirectionLabel = (direction: string) => {
    switch (direction) {
      case "credit":
        return "Money in";
      default:
        return "Money out";
    }
  };

  const getEntryTypeLabel = (entryType: string) => {
    switch (entryType) {
      case "payout":
        return "Payout";
      case "refund":
        return "Refund";
      case "adjustment":
        return "Balance update";
      default:
        return entryType
          .replace(/_/g, " ")
          .replace(/\b\w/g, (l) => l.toUpperCase());
    }
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-kk-line bg-kk-card shadow-sm">
      <div className="flex items-center justify-between border-b border-kk-line px-6 py-5">
        <h4 className="font-sora text-xl font-bold text-kk-ink">
          Recent activity
        </h4>
      </div>

      {payouts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-kk-sand text-kk-red-ink">
            <Receipt className="size-6" />
          </div>
          <p className="font-sora text-base font-bold text-kk-ink">
            No activity yet
          </p>
          <p className="max-w-sm text-sm text-kk-cocoa">
            Earnings and refunds will appear here after an order is completed.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-kk-sand">
              <tr>
                <th className="px-6 py-4 text-sm font-medium text-kk-cocoa">
                  Reference
                </th>
                <th className="px-6 py-4 text-sm font-medium text-kk-cocoa">
                  Date
                </th>
                <th className="px-6 py-4 text-sm font-medium text-kk-cocoa">
                  Activity
                </th>
                <th className="px-6 py-4 text-sm font-medium text-kk-cocoa">
                  Amount
                </th>
                <th className="px-6 py-4 text-sm font-medium text-kk-cocoa">
                  Direction
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(228,190,184,0.3)]">
              {payouts.map((payout) => (
                <tr
                  key={payout.id}
                  className="transition-colors hover:bg-kk-sand"
                >
                  <td className="px-6 py-4 text-sm font-bold text-kk-ink">
                    #{payout.id.slice(0, 8).toUpperCase()}
                  </td>
                  <td className="px-6 py-4 text-sm text-kk-cocoa">
                    {new Date(payout.created_at).toLocaleDateString("en-NG", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-6 py-4 text-sm text-kk-cocoa">
                    {getEntryTypeLabel(payout.entry_type)}
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-kk-red-ink">
                    {formatNaira(koboOf(payout.amount_kobo))}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusColor(payout.direction)}`}
                    >
                      {getDirectionLabel(payout.direction)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
