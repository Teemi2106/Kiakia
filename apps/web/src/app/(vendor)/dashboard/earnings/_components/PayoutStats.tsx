// app/(vendor)/earnings/_components/PayoutStats.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { ArrowDownCircle, ArrowUpCircle, ListChecks } from "lucide-react";
import type { Payout } from "./types";

interface PayoutStatsProps {
  payouts: Payout[];
}

export function PayoutStats({ payouts }: PayoutStatsProps) {
  const totalPaidOutKobo = payouts
    .filter((p) => p.entry_type === "payout")
    .reduce((sum, p) => sum + p.amount_kobo, 0);

  const totalRefundedKobo = payouts
    .filter((p) => p.entry_type === "refund")
    .reduce((sum, p) => sum + p.amount_kobo, 0);

  return (
    <div className="space-y-4 lg:col-span-4">
      {/* Total Paid Out */}
      <div className="rounded-3xl border border-kk-line bg-kk-card p-6 shadow-sm transition-all hover:shadow-md">
        <p className="mb-1 text-sm font-medium text-kk-cocoa">
          Total Paid Out
        </p>
        <h4 className="font-sora text-2xl font-bold text-kk-ink">
          {formatNaira(koboOf(totalPaidOutKobo))}
        </h4>
        <div className="mt-2 flex items-center gap-1 text-sm font-medium text-kk-cocoa">
          <ArrowUpCircle className="size-4" />
          Across the entries shown below
        </div>
      </div>

      {/* Total Refunded */}
      <div className="rounded-3xl border border-kk-line bg-kk-card p-6 shadow-sm transition-all hover:shadow-md">
        <p className="mb-1 text-sm font-medium text-kk-cocoa">
          Total Refunded
        </p>
        <h4 className="font-sora text-2xl font-bold text-kk-ink">
          {formatNaira(koboOf(totalRefundedKobo))}
        </h4>
        <div className="mt-2 flex items-center gap-1 text-sm font-medium text-kk-cocoa">
          <ArrowDownCircle className="size-4" />
          Across the entries shown below
        </div>
      </div>

      {/* Entries shown */}
      <div className="rounded-3xl border border-kk-line bg-kk-card p-6 shadow-sm transition-all hover:shadow-md">
        <p className="mb-1 text-sm font-medium text-kk-cocoa">
          Ledger Entries
        </p>
        <h4 className="font-sora text-2xl font-bold text-kk-ink">
          {payouts.length}
        </h4>
        <div className="mt-2 flex items-center gap-1 text-sm font-medium text-kk-cocoa">
          <ListChecks className="size-4" />
          Most recent, up to 50
        </div>
      </div>
    </div>
  );
}
