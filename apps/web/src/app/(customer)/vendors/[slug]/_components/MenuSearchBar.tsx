// app/(customer)/vendors/[slug]/_components/MenuSearchBar.tsx
"use client";

import { Search } from "lucide-react";

export function MenuSearchBar({
  value,
  onChange,
  vendorName,
}: {
  value: string;
  onChange: (value: string) => void;
  vendorName: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-kk-cocoa" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Search menu at ${vendorName}`}
        aria-label={`Search menu at ${vendorName}`}
        className="w-full rounded-full border border-kk-line bg-kk-card py-2.5 pl-10 pr-4 font-inter text-sm text-kk-ink placeholder:text-kk-cocoa/60 focus:border-kk-red focus:outline-none focus:ring-2 focus:ring-kk-red/20"
      />
    </div>
  );
}
