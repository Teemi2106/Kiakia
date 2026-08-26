// app/(vendor)/earnings/_components/RevenueChart.tsx
"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatNaira, koboOf } from "@kiakia/domain";
import type { Payout } from "./types";

const CHART_DAYS = 7;

interface RevenueChartProps {
  payouts: Payout[];
}

export function RevenueChart({ payouts }: RevenueChartProps) {
  const data = useMemo(() => {
    const byDay = new Map<string, number>();
    const labels: { key: string; label: string }[] = [];
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      labels.push({ key, label: d.toLocaleDateString("en-US", { weekday: "short" }) });
      byDay.set(key, 0);
    }

    for (const payout of payouts) {
      const key = payout.created_at.slice(0, 10);
      if (!byDay.has(key)) continue;
      const signed = payout.direction === "credit" ? payout.amount_kobo : -payout.amount_kobo;
      byDay.set(key, (byDay.get(key) ?? 0) + signed);
    }

    return labels.map(({ key, label }) => ({
      day: label,
      netKobo: Math.max(byDay.get(key) ?? 0, 0),
    }));
  }, [payouts]);

  return (
    <div className="rounded-3xl border border-[#E4BEB8] bg-white p-6 shadow-sm md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h4 className="font-sora text-xl font-bold text-[#1C1B1B]">
            Ledger Activity — Last 7 Days
          </h4>
          <p className="text-sm text-[#5B403C]">
            Net credits to your account, from real ledger entries
          </p>
        </div>
      </div>

      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#5B403C" }}
            />
            <YAxis hide={true} />
            <Tooltip
              cursor={{ fill: "rgba(182, 25, 19, 0.05)" }}
              contentStyle={{
                backgroundColor: "#1C1B1B",
                border: "none",
                borderRadius: "8px",
                color: "#FFFFFF",
                fontSize: "12px",
              }}
              formatter={(value) => [formatNaira(koboOf(Number(value) || 0)), "Net"]}
            />
            <Bar dataKey="netKobo" radius={[4, 4, 0, 0]} fill="#B61913" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
