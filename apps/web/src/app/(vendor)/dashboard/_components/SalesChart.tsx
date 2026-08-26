// app/(vendor)/dashboard/_components/SalesChart.tsx
"use client";

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
import type { SalesDataPoint } from "./types";

interface SalesChartProps {
  data: SalesDataPoint[];
}

export function SalesChart({ data }: SalesChartProps) {
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#5B403C" }}
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
            formatter={(value) => [formatNaira(koboOf(Number(value) || 0)), "Sales"]}
          />
          <Bar dataKey="salesKobo" radius={[4, 4, 0, 0]} fill="#B61913" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
