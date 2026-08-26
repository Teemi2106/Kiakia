// app/(vendor)/earnings/_components/EarningsMobile.tsx
"use client";

import { BalanceCard } from "./BalanceCard";
import { RevenueChart } from "./RevenueChart";
import { PayoutHistory } from "./PayoutHistory";
import { PayoutStats } from "./PayoutStats";
import type { Payout } from "./types";

interface EarningsMobileProps {
  availableKobo: number;
  pendingKobo: number;
  payouts: Payout[];
}

export function EarningsMobile({
  availableKobo,
  pendingKobo,
  payouts,
}: EarningsMobileProps) {
  return (
    <div className="p-4 pb-24 space-y-6">
      {/* Balance Cards */}
      <BalanceCard availableKobo={availableKobo} pendingKobo={pendingKobo} />

      {/* Analytics */}
      <div className="space-y-6">
        <RevenueChart payouts={payouts} />
        <PayoutStats payouts={payouts} />
      </div>

      {/* Payout History */}
      <PayoutHistory payouts={payouts} />
    </div>
  );
}
