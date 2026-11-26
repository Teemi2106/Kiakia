// app/(vendor)/dashboard/_components/StatsCards.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Clock, Wallet, TrendingUp } from "lucide-react";

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
        {/* Pending earnings */}
        <div className="flex flex-col justify-between rounded-2xl border border-kk-line bg-kk-card p-6 shadow-sm transition-shadow hover:shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <span className="rounded-xl bg-[rgba(147,75,0,0.1)] p-3 text-kk-orange-ink">
              <Clock className="size-6" />
            </span>
            <span className="font-inter text-xs font-medium leading-4 text-kk-cocoa">
              Pending
            </span>
          </div>
          <div>
            <p className="font-inter text-sm font-medium leading-5 text-kk-cocoa">
              Pending earnings
            </p>
            <h3 className="font-sora text-[32px] font-bold leading-10 text-kk-orange-ink">
              {formatNaira(koboOf(escrowKobo))}
            </h3>
          </div>
        </div>

        {/* Available balance */}
        <div className="flex flex-col justify-between rounded-2xl border border-kk-line bg-kk-card p-6 shadow-sm transition-shadow hover:shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <span className="rounded-xl bg-[rgba(23,106,34,0.1)] p-3 text-kk-green-ink">
              <Wallet className="size-6" />
            </span>
            <span className="rounded bg-[rgba(23,106,34,0.1)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-kk-green-ink">
              Available
            </span>
          </div>
          <div>
            <p className="font-inter text-sm font-medium leading-5 text-kk-cocoa">
              Available balance
            </p>
            <h3 className="font-sora text-[32px] font-bold leading-10 text-kk-green-ink">
              {formatNaira(koboOf(availableKobo))}
            </h3>
          </div>
        </div>

        {/* Active orders */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-2xl bg-kk-red p-6 text-white shadow-lg">
          <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-white/10" />
          <div className="relative z-10 mb-4 flex items-center justify-between">
            <span className="rounded-xl bg-white/20 p-3 text-white">
              <TrendingUp className="size-6" />
            </span>
            <span className="font-inter text-xs font-medium leading-4 text-white/80">
              In progress
            </span>
          </div>
          <div className="relative z-10">
            <p className="font-inter text-sm font-medium leading-5 text-white/80">
              Active orders
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
      {/* Pending earnings */}
      <div className="rounded-2xl border border-kk-line bg-kk-card p-6 shadow-sm transition-all hover:shadow-lg">
        <p className="mb-2 font-inter text-sm font-medium leading-5 text-kk-cocoa">
          Pending earnings
        </p>
        <p className="font-sora text-[32px] font-bold text-kk-orange-ink">
          {formatNaira(koboOf(escrowKobo))}
        </p>
        <div className="mt-4 flex items-center gap-2 text-kk-cocoa">
          <Clock className="size-3.5" />
          <span className="text-xs">Added to your available balance after delivery is confirmed</span>
        </div>
      </div>

      {/* Available balance */}
      <div className="relative overflow-hidden rounded-2xl bg-kk-red p-6 text-white shadow-md transition-all hover:shadow-lg group">
        <div className="relative z-10">
          <p className="mb-2 font-inter text-sm font-medium leading-5 text-white/90">
            Available balance
          </p>
          <p className="font-sora text-[32px] font-bold">
            {formatNaira(koboOf(availableKobo))}
          </p>
          <p className="mt-3 text-xs text-white/80">Vendor payouts are not available yet.</p>
        </div>
      </div>

      {/* Active orders */}
      <div className="rounded-2xl border border-kk-line bg-kk-card p-6 shadow-sm transition-all hover:shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <p className="mb-2 font-inter text-sm font-medium leading-5 text-kk-cocoa">
              Active orders
            </p>
            <p className="font-sora text-[32px] font-bold text-kk-ink">
              {activeCount}
            </p>
          </div>
          <div className="rounded-lg bg-[rgba(53,132,57,0.1)] p-2">
            <TrendingUp className="size-5 text-kk-green-ink" />
          </div>
        </div>
      </div>
    </div>
  );
}
