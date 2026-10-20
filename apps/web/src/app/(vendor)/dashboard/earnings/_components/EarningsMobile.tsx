// app/(vendor)/earnings/_components/EarningsMobile.tsx
"use client";

import dynamic from "next/dynamic";
import { BalanceCard } from "./BalanceCard";
import { PayoutHistory } from "./PayoutHistory";
import { PayoutStats } from "./PayoutStats";
import type { Payout } from "./types";

// recharts is ~300 KB of JS that only the chart needs; loading it on demand keeps it
// out of this page's first-load bundle, so the page is interactive before the chart is.
const RevenueChart = dynamic(() => import("./RevenueChart").then((m) => m.RevenueChart), {
  ssr: false,
  loading: () => <div className="h-48 w-full animate-pulse rounded-xl bg-[#F0EDED]" aria-hidden="true" />,
});


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
