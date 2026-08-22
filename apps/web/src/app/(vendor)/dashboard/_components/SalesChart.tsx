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

const data = [
  { day: "Mon", sales: 4000 },
  { day: "Tue", sales: 6500 },
  { day: "Wed", sales: 5000 },
  { day: "Thu", sales: 9000 },
  { day: "Fri", sales: 10000 },
];

export function SalesChart() {
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
          />
          <Bar dataKey="sales" radius={[4, 4, 0, 0]} fill="#B61913" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
