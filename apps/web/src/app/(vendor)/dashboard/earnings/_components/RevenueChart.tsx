// app/(vendor)/earnings/_components/RevenueChart.tsx
"use client";

import { useState } from "react";

const WEEKLY_DATA = [
  { day: "Mon", value: 40 },
  { day: "Tue", value: 65 },
  { day: "Wed", value: 85 },
  { day: "Thu", value: 55 },
  { day: "Fri", value: 95 },
  { day: "Sat", value: 75 },
  { day: "Sun", value: 35 },
];

const MONTHLY_DATA = [
  { day: "Week 1", value: 45 },
  { day: "Week 2", value: 70 },
  { day: "Week 3", value: 90 },
  { day: "Week 4", value: 60 },
];

export function RevenueChart() {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const data = period === "week" ? WEEKLY_DATA : MONTHLY_DATA;

  return (
    <div className="rounded-3xl border border-[#E4BEB8] bg-white p-6 shadow-sm md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h4 className="font-sora text-xl font-bold text-[#1C1B1B]">
            {period === "week" ? "Weekly Performance" : "Monthly Performance"}
          </h4>
          <p className="text-sm text-[#5B403C]">
            {period === "week"
              ? "Earnings from Jul 10 - Jul 16"
              : "Earnings by week"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPeriod("week")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              period === "week"
                ? "bg-[#F0EDED] text-[#1C1B1B]"
                : "text-[#5B403C] hover:bg-[#F0EDED]"
            }`}
          >
            Week
          </button>
          <button
            onClick={() => setPeriod("month")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              period === "month"
                ? "bg-[#F0EDED] text-[#1C1B1B]"
                : "text-[#5B403C] hover:bg-[#F0EDED]"
            }`}
          >
            Month
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="flex h-48 items-end justify-between gap-3 px-2 md:gap-6">
        {data.map((item, index) => (
          <div key={index} className="flex flex-1 flex-col items-center gap-3">
            <div
              className={`w-full rounded-t-lg transition-all duration-500 hover:brightness-90 ${
                index === 2 ? "bg-[#B61913]" : "bg-[#F0EDED]"
              }`}
              style={{ height: `${item.value}%` }}
            />
            <span className="text-xs font-medium text-[#5B403C]">
              {item.day}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
