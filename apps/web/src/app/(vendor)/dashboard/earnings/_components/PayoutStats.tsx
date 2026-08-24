// app/(vendor)/earnings/_components/PayoutStats.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Calendar, TrendingUp, Clock } from "lucide-react";

export function PayoutStats() {
  return (
    <div className="space-y-4 lg:col-span-4">
      {/* Avg Order Value */}
      <div className="rounded-3xl border border-[#E4BEB8] bg-white p-6 shadow-sm transition-all hover:shadow-md">
        <p className="mb-1 text-sm font-medium text-[#5B403C]">
          Avg. Order Value
        </p>
        <h4 className="font-sora text-2xl font-bold text-[#1C1B1B]">₦12,400</h4>
        <div className="mt-2 flex items-center gap-1 text-sm font-medium text-[#176A22]">
          <TrendingUp className="size-4" />
          4% better than avg
        </div>
      </div>

      {/* Total Payouts */}
      <div className="rounded-3xl border border-[#E4BEB8] bg-white p-6 shadow-sm transition-all hover:shadow-md">
        <p className="mb-1 text-sm font-medium text-[#5B403C]">Total Payouts</p>
        <h4 className="font-sora text-2xl font-bold text-[#1C1B1B]">₦8.2M</h4>
        <div className="mt-2 flex items-center gap-1 text-sm font-medium text-[#5B403C]">
          <Calendar className="size-4" />
          Over last 6 months
        </div>
      </div>

      {/* Next Payout */}
      <div className="rounded-3xl border border-[#E4BEB8] bg-white p-6 shadow-sm transition-all hover:shadow-md">
        <p className="mb-1 text-sm font-medium text-[#5B403C]">
          Next Scheduled Payout
        </p>
        <h4 className="font-sora text-2xl font-bold text-[#934B00]">
          Oct 24, 2023
        </h4>
        <div className="mt-2 flex items-center gap-1 text-sm font-medium text-[#5B403C]">
          <Clock className="size-8 text-[#5B403C]/40" />
          Processing in 3 days
        </div>
      </div>
    </div>
  );
}
