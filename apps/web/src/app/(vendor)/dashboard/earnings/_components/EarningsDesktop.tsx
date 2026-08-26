// app/(vendor)/earnings/_components/EarningsDesktop.tsx
"use client";

import { BalanceCard } from "./BalanceCard";
import { RevenueChart } from "./RevenueChart";
import { PayoutStats } from "./PayoutStats";
import { PayoutHistory } from "./PayoutHistory";
import type { Payout } from "./types";

interface EarningsDesktopProps {
  availableKobo: number;
  pendingKobo: number;
  payouts: Payout[];
}

export function EarningsDesktop({
  availableKobo,
  pendingKobo,
  payouts,
}: EarningsDesktopProps) {
  return (
    <div className="p-6 space-y-8">
      {/* Balance Cards */}
      <BalanceCard availableKobo={availableKobo} pendingKobo={pendingKobo} />

      {/* Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8">
          <RevenueChart payouts={payouts} />
        </div>
        <div className="lg:col-span-4">
          <PayoutStats payouts={payouts} />
        </div>
      </div>

      {/* Payout History */}
      <PayoutHistory payouts={payouts} />
    </div>
  );
}
