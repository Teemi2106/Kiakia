// app/(vendor)/earnings/_components/BalanceCard.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Lock, TrendingUp } from "lucide-react";

interface BalanceCardProps {
  availableKobo: number;
  pendingKobo: number;
}

export function BalanceCard({ availableKobo, pendingKobo }: BalanceCardProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Released Balance */}
      <div className="col-span-1 md:col-span-2 relative overflow-hidden rounded-3xl bg-[#B61913] p-8 text-white shadow-lg min-h-[220px]">
        <div className="relative z-10">
          <p className="mb-1 text-sm font-medium opacity-80">
            Released Balance
          </p>
          <h3 className="font-sora text-4xl font-extrabold md:text-5xl">
            {formatNaira(koboOf(availableKobo))}
          </h3>
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs font-medium">
            <TrendingUp className="size-3.5" />
            <span>+12.5% from last week</span>
          </div>
        </div>
        <div className="relative z-10 mt-6 flex gap-4">
          <button className="rounded-xl bg-white px-8 py-3 font-inter text-sm font-bold text-[#B61913] shadow-md transition-all hover:bg-[#F6F3F2] active:scale-95">
            Withdraw Funds
          </button>
        </div>
        <div className="absolute -right-16 -bottom-16 h-64 w-64 rounded-full bg-white/10 blur-3xl pointer-events-none" />
      </div>

      {/* Escrow Card */}
      <div className="flex flex-col justify-between rounded-3xl border border-[#E4BEB8] bg-white p-6 shadow-sm transition-all hover:shadow-md">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div className="rounded-lg bg-[rgba(147,75,0,0.1)] p-2">
              <Lock className="size-5 text-[#934B00]" />
            </div>
            <span className="rounded bg-[#F0EDED] px-2 py-1 text-xs font-medium text-[#5B403C]">
              Escrow
            </span>
          </div>
          <p className="mb-1 text-sm font-medium text-[#5B403C]">
            Pending Settlements
          </p>
          <h4 className="font-sora text-2xl font-bold text-[#1C1B1B]">
            {formatNaira(koboOf(pendingKobo))}
          </h4>
        </div>
        <div className="mt-4 border-t border-[#E4BEB8] pt-4">
          <p className="flex items-center gap-1 text-xs italic text-[#5B403C]">
            <span className="text-sm">ℹ️</span> Released after delivery
            confirmation
          </p>
        </div>
      </div>
    </div>
  );
}
