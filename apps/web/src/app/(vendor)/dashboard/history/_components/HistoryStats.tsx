// app/(vendor)/history/_components/HistoryStats.tsx
"use client";

import { CheckCircle, XCircle, Gavel } from "lucide-react";

interface HistoryStatsProps {
  fulfilled: number;
  cancelled: number;
  disputed: number;
}

export function HistoryStats({
  fulfilled,
  cancelled,
  disputed,
}: HistoryStatsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {/* Fulfilled */}
      <div className="flex flex-col justify-between rounded-xl border border-[#E4BEB8] bg-white p-4">
        <div className="mb-2 flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(23,106,34,0.1)] text-[#176A22]">
            <CheckCircle className="size-5" />
          </div>
          <span className="text-sm font-medium text-[#176A22]">+12.5%</span>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[#5B403C]">
            Fulfilled
          </p>
          <h3 className="font-sora text-2xl font-bold text-[#1C1B1B]">
            {fulfilled}
          </h3>
        </div>
      </div>

      {/* Cancelled */}
      <div className="flex flex-col justify-between rounded-xl border border-[#E4BEB8] bg-white p-4">
        <div className="mb-2 flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(186,26,26,0.1)] text-[#BA1A1A]">
            <XCircle className="size-5" />
          </div>
          <span className="text-sm font-medium text-[#BA1A1A]">-2.1%</span>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[#5B403C]">
            Cancelled
          </p>
          <h3 className="font-sora text-2xl font-bold text-[#1C1B1B]">
            {cancelled}
          </h3>
        </div>
      </div>

      {/* Disputed */}
      <div className="flex flex-col justify-between rounded-xl border border-[#E4BEB8] bg-white p-4">
        <div className="mb-2 flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(147,75,0,0.1)] text-[#934B00]">
            <Gavel className="size-5" />
          </div>
          <span className="text-sm font-medium text-[#934B00]">0.4%</span>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[#5B403C]">
            Disputed
          </p>
          <h3 className="font-sora text-2xl font-bold text-[#1C1B1B]">
            {disputed}
          </h3>
        </div>
      </div>
    </div>
  );
}
