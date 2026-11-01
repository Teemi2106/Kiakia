// app/(vendor)/earnings/_components/BalanceCard.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Lock, Info } from "lucide-react";

interface BalanceCardProps {
  availableKobo: number;
  pendingKobo: number;
}

export function BalanceCard({ availableKobo, pendingKobo }: BalanceCardProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Released Balance */}
      <div className="col-span-1 md:col-span-2 relative overflow-hidden rounded-3xl bg-kk-red p-8 text-white shadow-lg min-h-[220px]">
        <div className="relative z-10">
          <p className="mb-1 text-sm font-medium opacity-80">
            Released Balance
          </p>
          <h3 className="font-sora text-4xl font-extrabold md:text-5xl">
            {formatNaira(koboOf(availableKobo))}
          </h3>
        </div>
        <div className="relative z-10 mt-6 flex gap-4">
          <button
            type="button"
            disabled
            title="Withdrawals aren't available yet in this release"
            aria-disabled="true"
            className="cursor-not-allowed rounded-xl bg-kk-card/60 px-8 py-3 font-inter text-sm font-bold text-kk-red-ink/70 shadow-md"
          >
            Withdraw Funds (coming soon)
          </button>
        </div>
        <div className="absolute -right-16 -bottom-16 h-64 w-64 rounded-full bg-white/10 blur-3xl pointer-events-none" />
      </div>

      {/* Escrow Card */}
      <div className="flex flex-col justify-between rounded-3xl border border-kk-line bg-kk-card p-6 shadow-sm transition-all hover:shadow-md">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div className="rounded-lg bg-[rgba(147,75,0,0.1)] p-2">
              <Lock className="size-5 text-kk-orange-ink" />
            </div>
            <span className="rounded bg-kk-fill px-2 py-1 text-xs font-medium text-kk-cocoa">
              Escrow
            </span>
          </div>
          <p className="mb-1 text-sm font-medium text-kk-cocoa">
            Pending Settlements
          </p>
          <h4 className="font-sora text-2xl font-bold text-kk-ink">
            {formatNaira(koboOf(pendingKobo))}
          </h4>
        </div>
        <div className="mt-4 border-t border-kk-line pt-4">
          <p className="flex items-center gap-1.5 text-xs italic text-kk-cocoa">
            <Info className="size-4 shrink-0 text-kk-cocoa/60" /> Released
            after delivery confirmation
          </p>
        </div>
      </div>
    </div>
  );
}
