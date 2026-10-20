// app/(vendor)/earnings/_components/EarningsDesktop.tsx
"use client";

import dynamic from "next/dynamic";
import { BalanceCard } from "./BalanceCard";
import { PayoutStats } from "./PayoutStats";
import { PayoutHistory } from "./PayoutHistory";
import type { Payout } from "./types";

// recharts is ~300 KB of JS that only the chart needs; loading it on demand keeps it
// out of this page's first-load bundle, so the page is interactive before the chart is.
const RevenueChart = dynamic(() => import("./RevenueChart").then((m) => m.RevenueChart), {
  ssr: false,
  loading: () => <div className="h-48 w-full animate-pulse rounded-xl bg-[#F0EDED]" aria-hidden="true" />,
});


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
