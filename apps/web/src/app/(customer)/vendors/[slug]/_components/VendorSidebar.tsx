// app/(customer)/vendors/[slug]/_components/VendorSidebar.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Badge } from "@kiakia/ui";
import {
  Bike,
  ChevronDown,
  Clock,
  ShoppingBag,
  Star,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { VendorDayHours, VendorSummary } from "./types";

function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

interface HoursStatus {
  label: string;
  isOpenNow: boolean;
}

/** Reads today's entry out of the 7-day schedule and compares it to the
 * current wall-clock time. Deliberately only called on the client (see the
 * effect below) so a server-rendered "now" never disagrees with the
 * hydrated one. */
function getHoursStatus(hours: readonly VendorDayHours[] | null): HoursStatus | null {
  if (!hours || hours.length === 0) return null;
  const now = new Date();
  const today = hours.find((h) => h.day === now.getDay());
  if (!today || !today.isOpen) return { label: "Closed today", isOpenNow: false };

  const [closeH, closeM] = today.closesAt.split(":").map(Number);
  const [openH, openM] = today.opensAt.split(":").map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const opensAtMinutes = openH * 60 + openM;
  const closesAtMinutes = closeH * 60 + closeM;

  if (nowMinutes < opensAtMinutes) {
    return { label: `Opens at ${formatTime12h(today.opensAt)}`, isOpenNow: false };
  }
  if (nowMinutes >= closesAtMinutes) {
    return { label: "Closed for today", isOpenNow: false };
  }
  return { label: `Open until ${formatTime12h(today.closesAt)}`, isOpenNow: true };
}

function formatDeliveryRadius(meters: number): string {
  if (meters <= 0) return "Not set";
  const km = meters / 1000;
  return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)} km radius`;
}

export function VendorSidebar({ vendor }: { vendor: VendorSummary }) {
  const [hoursStatus, setHoursStatus] = useState<HoursStatus | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    // setState lives inside an async function, never directly in this
    // synchronous effect body — matching useOrderTracking.ts's convention,
    // since react-hooks/set-state-in-effect flags the latter. The status is
    // genuinely derived from wall-clock time, so it can only be computed
    // client-side, after mount.
    async function run() {
      setHoursStatus(getHoursStatus(vendor.operatingHours));
    }
    void run();
  }, [vendor.operatingHours]);

  return (
    <div className="flex flex-col gap-4">
      {/* Identity card */}
      <div className="overflow-hidden rounded-2xl border border-[#E4BEB8] bg-white shadow-sm">
        {vendor.bannerUrl && (
          <div className="relative h-24 w-full bg-[#E5E2E1]">
            <Image
              src={vendor.bannerUrl}
              alt=""
              fill
              sizes="320px"
              className="object-cover"
            />
          </div>
        )}
        <div className="p-5">
          <div
            className={`flex items-center gap-3 ${vendor.bannerUrl ? "-mt-12" : ""}`}
          >
            <div className="relative size-16 shrink-0 overflow-hidden rounded-2xl border-2 border-white bg-[#F0EDED] shadow-sm">
              {vendor.logoUrl ? (
                <Image
                  src={vendor.logoUrl}
                  alt={vendor.name}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#E5E2E1] to-[#F0EDED]">
                  <ShoppingBag className="size-6 text-[#5B403C]/40" />
                </div>
              )}
            </div>
          </div>

          <div className="mt-3">
            <h1 className="font-sora text-xl font-bold leading-tight text-[#1C1B1B]">
              {vendor.name}
            </h1>
            <p className="mt-0.5 font-inter text-sm text-[#5B403C]">
              {vendor.category || "Various"}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {vendor.isAcceptingOrders ? (
              <Badge className="bg-[rgba(218,53,41,0.1)] text-[#DA3529] hover:bg-[rgba(218,53,41,0.1)]">
                Accepting orders
              </Badge>
            ) : (
              <Badge tone="neutral" className="bg-[#EAE7E7] text-[#5B403C]">
                Currently closed
              </Badge>
            )}
            {vendor.ratingCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-[#F0EDED] px-2.5 py-1 font-inter text-xs font-semibold text-[#1C1B1B]">
                <Star className="size-3.5 fill-[#FE8E27] text-[#FE8E27]" />
                {vendor.ratingAvg.toFixed(1)}
                <span className="font-normal text-[#5B403C]">
                  ({vendor.ratingCount})
                </span>
              </span>
            )}
          </div>

          {/* Hours — client-computed, so render nothing until mounted rather
           * than risk a stale/mismatched server guess. */}
          {hoursStatus && (
            <div
              className={`mt-3 flex items-center gap-1.5 font-inter text-sm font-medium ${
                hoursStatus.isOpenNow ? "text-[#176A22]" : "text-[#5B403C]"
              }`}
            >
              <Clock className="size-4" />
              {hoursStatus.label}
            </div>
          )}
          {vendor.operatingHours === null && (
            <div className="mt-3 flex items-center gap-1.5 font-inter text-sm text-[#5B403C]/70">
              <Clock className="size-4" />
              Hours not set
            </div>
          )}

          {vendor.description && (
            <div className="mt-3 border-t border-[#F0EDED] pt-3">
              <button
                type="button"
                onClick={() => setInfoOpen((v) => !v)}
                className="flex w-full items-center justify-between font-inter text-sm font-semibold text-[#1C1B1B]"
              >
                More info
                <ChevronDown
                  className={`size-4 text-[#5B403C] transition-transform ${infoOpen ? "rotate-180" : ""}`}
                />
              </button>
              {infoOpen && (
                <p className="mt-2 font-inter text-sm text-[#5B403C]">
                  {vendor.description}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delivery & order info — real fields, no invented promo content */}
      <div className="rounded-2xl border border-[#E4BEB8] bg-white p-5 shadow-sm">
        <h2 className="font-sora text-sm font-semibold text-[#1C1B1B]">
          Delivery &amp; order info
        </h2>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#B61913]/10 text-[#B61913]">
              <Bike className="size-4" />
            </div>
            <span className="font-inter text-sm text-[#1C1B1B]">
              Delivers within {formatDeliveryRadius(vendor.deliveryRadiusM)}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#B61913]/10 text-[#B61913]">
              <Wallet className="size-4" />
            </div>
            <span className="font-inter text-sm text-[#1C1B1B]">
              {vendor.minOrderKobo > 0
                ? `Min. order ${formatNaira(koboOf(vendor.minOrderKobo))}`
                : "No minimum order"}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#B61913]/10 text-[#B61913]">
              <Clock className="size-4" />
            </div>
            <span className="font-inter text-sm text-[#1C1B1B]">
              ~{vendor.avgPrepMins} min prep time
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
