// app/(vendor)/dashboard/_components/StatsCards.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Lock, Wallet, TrendingUp } from "lucide-react";

interface StatsCardsProps {
  activeCount: number;
  escrowKobo: number;
  availableKobo: number;
  variant?: "desktop" | "mobile";
}

export function StatsCards({
  activeCount,
  escrowKobo,
  availableKobo,
  variant = "desktop",
}: StatsCardsProps) {
  const isDesktop = variant === "desktop";

  if (isDesktop) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Escrow Pending */}
        <div className="flex flex-col justify-between rounded-xl border border-[#E4BEB8] bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <span className="rounded-xl bg-[rgba(147,75,0,0.1)] p-3 text-[#934B00]">
              <Lock className="size-6" />
            </span>
            <span className="font-inter text-xs font-medium leading-4 text-[#5B403C]">
              Safety Lock
            </span>
          </div>
          <div>
            <p className="font-inter text-sm font-medium leading-5 text-[#5B403C]">
              Escrow Pending
            </p>
            <h3 className="font-sora text-[32px] font-bold leading-10 text-[#934B00]">
              {formatNaira(koboOf(escrowKobo))}
            </h3>
          </div>
        </div>

        {/* Released Balance */}
        <div className="flex flex-col justify-between rounded-xl border border-[#E4BEB8] bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <span className="rounded-xl bg-[rgba(23,106,34,0.1)] p-3 text-[#176A22]">
              <Wallet className="size-6" />
            </span>
            <span className="rounded bg-[rgba(23,106,34,0.1)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#176A22]">
              Available
            </span>
          </div>
          <div>
            <p className="font-inter text-sm font-medium leading-5 text-[#5B403C]">
              Released Balance
            </p>
            <h3 className="font-sora text-[32px] font-bold leading-10 text-[#176A22]">
              {formatNaira(koboOf(availableKobo))}
            </h3>
          </div>
        </div>

        {/* Today's Orders */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-xl bg-[#B61913] p-6 text-white shadow-lg">
          <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-white/10" />
          <div className="relative z-10 mb-4 flex items-center justify-between">
            <span className="rounded-xl bg-white/20 p-3 text-white">
              <TrendingUp className="size-6" />
            </span>
            <span className="font-inter text-xs font-medium leading-4 text-white/80">
              Active Session
            </span>
          </div>
          <div className="relative z-10">
            <p className="font-inter text-sm font-medium leading-5 text-white/80">
              Today&apos;s Orders
            </p>
            <h3 className="font-sora text-[32px] font-bold leading-10">
              {activeCount}
            </h3>
          </div>
        </div>
      </div>
    );
  }

  // Mobile version
  return (
    <div className="grid grid-cols-1 gap-4">
      {/* Escrow Pending */}
      <div className="rounded-xl border border-[#E4BEB8] bg-white p-6 shadow-sm transition-all hover:shadow-lg">
        <p className="mb-2 font-inter text-sm font-medium leading-5 text-[#5B403C]">
          Escrow Pending
        </p>
        <p className="font-sora text-[32px] font-bold text-[#934B00]">
          {formatNaira(koboOf(escrowKobo))}
        </p>
        <div className="mt-4 flex items-center gap-2 text-[#5B403C]">
          <Lock className="size-3.5" />
          <span className="text-xs">Released after delivery confirmation</span>
        </div>
      </div>

      {/* Released Balance */}
      <div className="relative overflow-hidden rounded-xl bg-[#B61913] p-6 text-white shadow-md transition-all hover:shadow-lg group">
        <div className="relative z-10">
          <p className="mb-2 font-inter text-sm font-medium leading-5 text-white/90">
            Released Balance
          </p>
          <p className="font-sora text-[32px] font-bold">
            {formatNaira(koboOf(availableKobo))}
          </p>
          <button
            type="button"
            disabled
            title="Withdrawals aren't available yet in this release"
            aria-disabled="true"
            className="mt-4 cursor-not-allowed rounded-lg bg-white/20 px-4 py-2 text-xs font-bold text-white/70"
          >
            Withdraw (coming soon)
          </button>
        </div>
      </div>

      {/* Today's Orders */}
      <div className="rounded-xl border border-[#E4BEB8] bg-white p-6 shadow-sm transition-all hover:shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <p className="mb-2 font-inter text-sm font-medium leading-5 text-[#5B403C]">
              Today&apos;s Orders
            </p>
            <p className="font-sora text-[32px] font-bold text-[#1C1B1B]">
              {activeCount}
            </p>
          </div>
          <div className="rounded-lg bg-[rgba(53,132,57,0.1)] p-2">
            <TrendingUp className="size-5 text-[#176A22]" />
          </div>
        </div>
      </div>
    </div>
  );
}
