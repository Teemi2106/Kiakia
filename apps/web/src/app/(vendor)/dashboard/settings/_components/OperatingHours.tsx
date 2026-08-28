// app/(vendor)/settings/_components/OperatingHours.tsx
"use client";

import { useActionState, useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@kiakia/ui";
import { updateVendorOperatingHoursAction, type FormState } from "@/app/actions/vendor";
import type { DayHours, VendorSettings } from "./types";

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const DEFAULT_OPENS_AT = "09:00";
const DEFAULT_CLOSES_AT = "21:00";

function defaultDayHours(day: number): DayHours {
  return { day, isOpen: true, opensAt: DEFAULT_OPENS_AT, closesAt: DEFAULT_CLOSES_AT };
}

/** Seeds a stable 7-entry (Sun..Sat) array from whatever the store has saved
 * so far — `vendor.operatingHours` is null until the vendor has ever saved
 * hours, in which case every day defaults to a sensible open schedule. */
function seedHours(existing: DayHours[] | null): DayHours[] {
  if (!existing) return Array.from({ length: 7 }, (_, day) => defaultDayHours(day));
  const byDay = new Map(existing.map((entry) => [entry.day, entry]));
  return Array.from({ length: 7 }, (_, day) => byDay.get(day) ?? defaultDayHours(day));
}

const initialState: FormState = {};

export function OperatingHours({ vendor }: { vendor: VendorSettings }) {
  const [state, formAction, pending] = useActionState(updateVendorOperatingHoursAction, initialState);
  const [hours, setHours] = useState<DayHours[]>(() => seedHours(vendor.operatingHours));

  function updateDay(day: number, patch: Partial<DayHours>) {
    setHours((prev) => prev.map((entry) => (entry.day === day ? { ...entry, ...patch } : entry)));
  }

  return (
    <form action={formAction} className="rounded-2xl border border-[#E4BEB8] bg-white p-6 shadow-sm">
      <input type="hidden" name="vendorId" value={vendor.id} />
      <input type="hidden" name="operatingHours" value={JSON.stringify(hours)} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
            Operating Hours
          </h2>
          <p className="text-sm text-[#5B403C]">
            Set when your kitchen is open for orders.
          </p>
        </div>
        <Button type="submit" loading={pending}>
          Save Changes
        </Button>
      </div>

      <div className="space-y-3">
        {hours.map((entry) => (
          <div
            key={entry.day}
            className={`flex flex-wrap items-center justify-between gap-4 rounded-xl p-4 transition-colors ${
              entry.isOpen ? "bg-[#F6F3F2]" : "bg-[#F6F3F2]/50"
            }`}
          >
            <div className="flex min-w-[140px] items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#B61913]/10 text-[#B61913]">
                <Clock className="size-5" />
              </div>
              <span className="font-inter text-sm font-medium text-[#1C1B1B]">
                {DAY_LABELS[entry.day]}
              </span>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex flex-col">
                <label
                  htmlFor={`opensAt-${entry.day}`}
                  className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#5B403C]"
                >
                  Opens
                </label>
                <input
                  id={`opensAt-${entry.day}`}
                  type="time"
                  value={entry.opensAt}
                  onChange={(e) => updateDay(entry.day, { opensAt: e.target.value })}
                  disabled={!entry.isOpen}
                  className="rounded-lg border border-[#E4BEB8] bg-white p-2 font-inter text-sm focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20 disabled:opacity-50"
                />
              </div>
              <span className="text-[#5B403C]">to</span>
              <div className="flex flex-col">
                <label
                  htmlFor={`closesAt-${entry.day}`}
                  className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#5B403C]"
                >
                  Closes
                </label>
                <input
                  id={`closesAt-${entry.day}`}
                  type="time"
                  value={entry.closesAt}
                  onChange={(e) => updateDay(entry.day, { closesAt: e.target.value })}
                  disabled={!entry.isOpen}
                  className="rounded-lg border border-[#E4BEB8] bg-white p-2 font-inter text-sm focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20 disabled:opacity-50"
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  entry.isOpen
                    ? "bg-[#176A22]/10 text-[#176A22]"
                    : "bg-[#BA1A1A]/10 text-[#BA1A1A]"
                }`}
              >
                {entry.isOpen ? "OPEN" : "CLOSED"}
              </span>
              <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                <input
                  type="checkbox"
                  checked={entry.isOpen}
                  onChange={() => updateDay(entry.day, { isOpen: !entry.isOpen })}
                  className="peer sr-only"
                />
                <span className="absolute inset-0 rounded-full bg-[#F0EDED] transition-colors peer-checked:bg-[#176A22]" />
                <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
              </span>
            </label>
          </div>
        ))}
      </div>

      {state.error && <p className="mt-4 text-sm text-[#BA1A1A]">{state.error}</p>}
      {state.success && <p className="mt-4 text-sm text-[#176A22]">Saved.</p>}
    </form>
  );
}
