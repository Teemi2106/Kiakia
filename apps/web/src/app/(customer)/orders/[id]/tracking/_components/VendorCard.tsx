// app/(customer)/tracking/_components/VendorCard.tsx
"use client";

import { ChevronRight } from "lucide-react";

interface VendorCardProps {
  vendor: {
    name: string;
    itemCount: number;
    logoUrl?: string;
  };
}

export function VendorCard({ vendor }: VendorCardProps) {
  return (
    <div className="rounded-xl border border-[#E4BEB8] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 overflow-hidden rounded-lg border border-[#E4BEB8] bg-[#DCD9D9]">
          {vendor.logoUrl ? (
            <div
              className="h-full w-full bg-cover bg-center"
              style={{ backgroundImage: `url(${vendor.logoUrl})` }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#DCD9D9] text-xl">
              🍽️
            </div>
          )}
        </div>

        <div className="flex-1">
          <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
            {vendor.name}
          </p>
          <p className="font-inter text-xs font-medium text-[#5B403C]">
            Order contains {vendor.itemCount} items
          </p>
        </div>

        <button className="rounded-full p-2 hover:bg-black/5">
          <ChevronRight className="size-4 text-[#934B00]" />
        </button>
      </div>
    </div>
  );
}
