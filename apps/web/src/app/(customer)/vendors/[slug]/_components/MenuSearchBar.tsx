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
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#5B403C]" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Search menu at ${vendorName}`}
        aria-label={`Search menu at ${vendorName}`}
        className="w-full rounded-full border border-[#E4BEB8] bg-white py-2.5 pl-10 pr-4 font-inter text-sm text-[#1C1B1B] placeholder:text-[#5B403C]/60 focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
      />
    </div>
  );
}
