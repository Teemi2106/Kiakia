// app/(vendor)/dashboard/_components/StatsCards.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Lock, Wallet, TrendingUp, CircleDollarSign} from "lucide-react";

interface StatsCardsProps {
  activeCount: number;
  variant?: "desktop" | "mobile";
}

export function StatsCards({
  activeCount,
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
              ₦125,000
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
              ₦450,000
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
              Today's Orders
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
          ₦125,000
        </p>
        <div className="mt-4 flex items-center gap-2 text-[#5B403C]">
          <span className="text-sm">⏱</span>
          <span className="text-xs">8 orders in transit</span>
        </div>
      </div>

      {/* Released Balance */}
      <div className="relative overflow-hidden rounded-xl bg-[#B61913] p-6 text-white shadow-md transition-all hover:shadow-lg group">
        <div className="relative z-10">
          <p className="mb-2 font-inter text-sm font-medium leading-5 text-white/90">
            Released Balance
          </p>
          <p className="font-sora text-[32px] font-bold">₦450,000</p>
          <button className="mt-4 rounded-lg bg-white/20 px-4 py-2 text-xs font-bold transition-colors hover:bg-white/30">
            Withdraw Now
          </button>
        </div>
        <span className="absolute -bottom-4 -right-4 text-9xl opacity-10 group-hover:rotate-12 transition-transform">
          <CircleDollarSign className="size-8 text-[#5B403C]/40" />
        </span>
      </div>

      {/* Today's Orders */}
      <div className="rounded-xl border border-[#E4BEB8] bg-white p-6 shadow-sm transition-all hover:shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <p className="mb-2 font-inter text-sm font-medium leading-5 text-[#5B403C]">
              Today's Orders
            </p>
            <p className="font-sora text-[32px] font-bold text-[#1C1B1B]">
              {activeCount}
            </p>
          </div>
          <div className="rounded-lg bg-[rgba(53,132,57,0.1)] p-2">
            <TrendingUp className="size-5 text-[#176A22]" />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-[#176A22]">
          <span className="text-xs font-bold">+12% from yesterday</span>
        </div>
      </div>
    </div>
  );
}
