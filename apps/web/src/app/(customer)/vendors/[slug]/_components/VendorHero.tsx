// app/(customer)/vendors/[slug]/_components/VendorHero.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Badge } from "@kiakia/ui";
import { Star, Clock, MapPin, ShoppingBag } from "lucide-react";
import Image from "next/image";

interface VendorHeroProps {
  vendor: {
    name: string;
    description: string | null;
    bannerUrl: string | null;
    ratingAvg: number;
    ratingCount: number;
    avgPrepMins: number;
    isAcceptingOrders: boolean;
    minOrderKobo: number;
    category: string;
  };
}

export function VendorHero({ vendor }: VendorHeroProps) {
  return (
    <div className="relative">
      {/* Banner Image */}
      <div className="relative h-[256px] w-full overflow-hidden bg-[#E5E2E1] sm:h-[256px]">
        {vendor.bannerUrl ? (
          <Image
            src={vendor.bannerUrl}
            alt={vendor.name}
            fill
            className="object-cover"
            priority
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1]">
            <ShoppingBag className="size-12 text-[#5B403C]/30" />
          </div>
        )}
        {/* Gradient overlay for mobile */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent sm:hidden" />
      </div>

      {/* Vendor Info Card - Desktop */}
      <div className="hidden sm:block">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 -mt-20 relative z-10">
          <div className="rounded-2xl border border-[#E5E2E1] bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-2">
                <h1 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.32px] text-[#1C1B1B]">
                  {vendor.name}
                </h1>
                <p className="font-inter text-base text-[#5B403C]">
                  {vendor.description || "No description available"}
                </p>
                <div className="flex flex-wrap items-center gap-4">
                  {/* Rating */}
                  {vendor.ratingCount > 0 && (
                    <div className="flex items-center gap-2 rounded-full bg-[#F0EDED] px-3 py-1">
                      <Star className="size-4 fill-[#FE8E27] text-[#FE8E27]" />
                      <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
                        {vendor.ratingAvg.toFixed(1)} ({vendor.ratingCount}{" "}
                        reviews)
                      </span>
                    </div>
                  )}
                  {/* Prep Time */}
                  <div className="flex items-center gap-2 rounded-full bg-[#F0EDED] px-3 py-1">
                    <Clock className="size-4 text-[#5B403C]" />
                    <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
                      ~{vendor.avgPrepMins} min
                    </span>
                  </div>
                  {/* Min Order */}
                  {vendor.minOrderKobo > 0 && (
                    <div className="flex items-center gap-2 rounded-full bg-[#F0EDED] px-3 py-1">
                      <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
                        Min. {formatNaira(koboOf(vendor.minOrderKobo))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {/* Status Badge */}
              {vendor.isAcceptingOrders ? (
                <Badge className="bg-[rgba(218,53,41,0.1)] text-[#DA3529] hover:bg-[rgba(218,53,41,0.1)]">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#DA3529]" />
                    Accepting Orders
                  </span>
                </Badge>
              ) : (
                <Badge tone="neutral" className="bg-[#EAE7E7] text-[#5B403C]">
                  Currently Closed
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Vendor Info Card - Mobile (Overlapping) */}
      <div className="sm:hidden">
        <div className="mx-auto -mt-16 px-4 relative z-10">
          <div className="rounded-xl border border-[rgba(228,190,184,0.3)] bg-white p-5 shadow-lg">
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <h1 className="font-sora text-[28px] font-bold leading-[34px] text-[#1C1B1B]">
                  {vendor.name}
                </h1>
                <button
                  className="rounded-full p-2 hover:bg-black/5"
                  aria-label="Share"
                >
                  <span className="size-5 text-[#B61913]">↗</span>
                </button>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap items-center gap-2">
                {vendor.ratingCount > 0 && (
                  <div className="flex items-center gap-1 rounded bg-[#F6F3F2] px-2 py-1">
                    <Star className="size-3 fill-[#FE8E27] text-[#FE8E27]" />
                    <span className="font-inter text-sm font-bold text-[#1C1B1B]">
                      {vendor.ratingAvg.toFixed(1)}
                    </span>
                    <span className="font-inter text-xs text-[#5B403C]">
                      ({vendor.ratingCount})
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1 rounded bg-[#F6F3F2] px-2 py-1">
                  <Clock className="size-3 text-[#5B403C]" />
                  <span className="font-inter text-xs text-[#5B403C]">
                    {vendor.avgPrepMins} min
                  </span>
                </div>
                {vendor.minOrderKobo > 0 && (
                  <div className="flex items-center gap-1 rounded bg-[#F6F3F2] px-2 py-1">
                    <span className="font-inter text-xs text-[#5B403C]">
                      Min. {formatNaira(koboOf(vendor.minOrderKobo))}
                    </span>
                  </div>
                )}
              </div>

              {/* Status Badges */}
              <div className="flex flex-wrap gap-2 border-t border-[rgba(229,226,225,0.5)] pt-3">
                {vendor.isAcceptingOrders ? (
                  <span className="rounded-full bg-[rgba(254,142,39,0.2)] px-3 py-0.5 text-xs font-medium text-[#934B00]">
                    Open
                  </span>
                ) : (
                  <span className="rounded-full bg-[#EAE7E7] px-3 py-0.5 text-xs font-medium text-[#5B403C]">
                    Closed
                  </span>
                )}
                <span className="rounded-full bg-[#EAE7E7] px-3 py-0.5 text-xs font-medium text-[#5B403C]">
                  {vendor.category || "Various"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
