// app/(vendor)/settings/_components/OperatingHours.tsx
"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";

interface DaySchedule {
  day: string;
  open: string;
  close: string;
  active: boolean;
}

const DEFAULT_SCHEDULE: DaySchedule[] = [
  { day: "Mon - Fri", open: "08:00", close: "22:00", active: true },
  { day: "Saturday", open: "09:00", close: "23:00", active: true },
  { day: "Sunday", open: "00:00", close: "00:00", active: false },
];

export function OperatingHours() {
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE);

  const toggleActive = (index: number) => {
    const newSchedule = [...schedule];
    newSchedule[index].active = !newSchedule[index].active;
    setSchedule(newSchedule);
  };

  const updateTime = (
    index: number,
    field: "open" | "close",
    value: string,
  ) => {
    const newSchedule = [...schedule];
    newSchedule[index][field] = value;
    setSchedule(newSchedule);
  };

  return (
    <div className="rounded-xl border border-[#E4BEB8] bg-white p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
            Operating Hours
          </h2>
          <p className="text-sm text-[#5B403C]">
            Set when your kitchen is open for orders.
          </p>
        </div>
        <button className="rounded-xl bg-[#B61913] px-6 py-2 font-inter text-sm font-medium text-white transition-colors hover:bg-[#9e1611]">
          Save Changes
        </button>
      </div>

      <div className="space-y-4">
        {schedule.map((day, index) => (
          <div
            key={day.day}
            className={`flex flex-wrap items-center justify-between gap-4 rounded-xl p-4 ${
              day.active
                ? "bg-[#F6F3F2]"
                : "bg-[rgba(246,243,242,0.5)] opacity-70"
            }`}
          >
            <div className="flex min-w-[120px] items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(182,25,19,0.1)] text-[#B61913]">
                <Calendar className="size-5" />
              </div>
              <span className="font-inter text-sm font-medium text-[#1C1B1B]">
                {day.day}
              </span>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex flex-col">
                <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#5B403C]">
                  Opens
                </label>
                <input
                  type="time"
                  value={day.open}
                  onChange={(e) => updateTime(index, "open", e.target.value)}
                  disabled={!day.active}
                  className="rounded-lg border border-[#E4BEB8] bg-white p-2 font-inter text-sm focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20 disabled:opacity-50"
                />
              </div>
              <span className="text-[#5B403C]">to</span>
              <div className="flex flex-col">
                <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#5B403C]">
                  Closes
                </label>
                <input
                  type="time"
                  value={day.close}
                  onChange={(e) => updateTime(index, "close", e.target.value)}
                  disabled={!day.active}
                  className="rounded-lg border border-[#E4BEB8] bg-white p-2 font-inter text-sm focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20 disabled:opacity-50"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  day.active
                    ? "bg-[rgba(23,106,34,0.1)] text-[#176A22]"
                    : "bg-[rgba(186,26,26,0.1)] text-[#BA1A1A]"
                }`}
              >
                {day.active ? "ACTIVE" : "INACTIVE"}
              </span>
              <button
                onClick={() => toggleActive(index)}
                className="relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors focus:outline-none"
                style={{
                  backgroundColor: day.active ? "#176A22" : "#F0EDED",
                }}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    day.active ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
