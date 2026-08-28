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
  const total = fulfilled + cancelled + disputed;
  const shareOf = (count: number) =>
    total === 0 ? "—" : `${Math.round((count / total) * 1000) / 10}% of orders shown`;

  return (
    <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
      {/* Fulfilled */}
      <div className="flex flex-col justify-between rounded-2xl border border-[#E4BEB8] bg-white p-6 shadow-sm transition-all hover:shadow-md">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex size-11 items-center justify-center rounded-xl bg-[rgba(23,106,34,0.1)] text-[#176A22]">
            <CheckCircle className="size-5" />
          </div>
          <span className="text-sm font-medium text-[#176A22]">
            {shareOf(fulfilled)}
          </span>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[#5B403C]">
            Fulfilled
          </p>
          <h3 className="font-sora text-3xl font-bold text-[#1C1B1B]">
            {fulfilled}
          </h3>
        </div>
      </div>

      {/* Cancelled */}
      <div className="flex flex-col justify-between rounded-2xl border border-[#E4BEB8] bg-white p-6 shadow-sm transition-all hover:shadow-md">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex size-11 items-center justify-center rounded-xl bg-[rgba(186,26,26,0.1)] text-[#BA1A1A]">
            <XCircle className="size-5" />
          </div>
          <span className="text-sm font-medium text-[#BA1A1A]">
            {shareOf(cancelled)}
          </span>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[#5B403C]">
            Cancelled
          </p>
          <h3 className="font-sora text-3xl font-bold text-[#1C1B1B]">
            {cancelled}
          </h3>
        </div>
      </div>

      {/* Disputed */}
      <div className="flex flex-col justify-between rounded-2xl border border-[#E4BEB8] bg-white p-6 shadow-sm transition-all hover:shadow-md">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex size-11 items-center justify-center rounded-xl bg-[rgba(147,75,0,0.1)] text-[#934B00]">
            <Gavel className="size-5" />
          </div>
          <span className="text-sm font-medium text-[#934B00]">
            {shareOf(disputed)}
          </span>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[#5B403C]">
            Disputed
          </p>
          <h3 className="font-sora text-3xl font-bold text-[#1C1B1B]">
            {disputed}
          </h3>
        </div>
      </div>
    </div>
  );
}
