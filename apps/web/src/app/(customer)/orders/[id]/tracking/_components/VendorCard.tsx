// app/(customer)/tracking/_components/VendorCard.tsx
"use client";

import { ForkKnifeCrossed, Phone } from "lucide-react";

interface VendorCardProps {
  vendor: {
    name: string;
    itemCount: number;
    logoUrl?: string;
    phone?: string;
  };
}

export function VendorCard({ vendor }: VendorCardProps) {
  return (
    <div className="rounded-xl border border-kk-line bg-kk-card p-4 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 overflow-hidden rounded-lg border border-kk-line bg-kk-fill-deep">
          {vendor.logoUrl ? (
            <div
              className="h-full w-full bg-cover bg-center"
              style={{ backgroundImage: `url(${vendor.logoUrl})` }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-kk-fill-deep text-xl">
              <ForkKnifeCrossed />
            </div>
          )}
        </div>

        <div className="flex-1">
          <p className="font-inter text-sm font-semibold text-kk-ink">
            {vendor.name}
          </p>
          <p className="font-inter text-xs font-medium text-kk-cocoa">
            Order contains {vendor.itemCount} items
          </p>
        </div>
      </div>
      {vendor.phone && (
        <a
          href={`tel:${vendor.phone}`}
          aria-label={`Call ${vendor.name} at ${vendor.phone}`}
          className="mt-3 flex items-center gap-2 rounded-xl border border-kk-line px-3 py-2 font-inter text-sm font-semibold text-kk-orange-ink hover:bg-kk-sand"
        >
          <Phone className="size-4" />
          <span>{vendor.phone}</span>
          <span className="ml-auto">Call vendor</span>
        </a>
      )}
    </div>
  );
}
