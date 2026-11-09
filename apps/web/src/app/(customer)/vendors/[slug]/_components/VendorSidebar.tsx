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

function formatDeliveryReach(meters: number): string {
  if (meters <= 0) return "Delivery area not set";
  const km = meters / 1000;
  return `Delivers up to ${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)} km from this kitchen`;
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
      {/* Compact mobile summary keeps the menu close while preserving details. */}
      <div className="rounded-2xl border border-kk-line bg-kk-card p-3 shadow-sm lg:hidden">
        <div className="flex items-center gap-3">
          <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-kk-fill">
            {vendor.logoUrl ? (
              <Image src={vendor.logoUrl} alt={vendor.name} fill sizes="48px" className="object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <ShoppingBag className="size-5 text-kk-cocoa/40" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-sora text-base font-bold text-kk-ink">{vendor.name}</h1>
            <div className="mt-1 flex items-center gap-2 font-inter text-xs text-kk-cocoa">
              <span>{vendor.category || "Various"}</span>
              {vendor.ratingCount > 0 && <span className="flex items-center gap-1 font-semibold text-kk-ink"><Star className="size-3 fill-kk-orange text-kk-orange" />{vendor.ratingAvg.toFixed(1)}</span>}
              <span>{vendor.isAcceptingOrders ? "Open" : "Closed"}</span>
            </div>
          </div>
          <button type="button" onClick={() => setInfoOpen((value) => !value)} aria-expanded={infoOpen} className="flex shrink-0 items-center gap-1 rounded-full bg-kk-fill px-3 py-2 font-inter text-xs font-semibold text-kk-ink">
            Info
            <ChevronDown className={`size-3.5 transition-transform ${infoOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
        {infoOpen && (
          <div className="mt-3 space-y-2 border-t border-kk-fill pt-3 font-inter text-sm text-kk-cocoa">
            {hoursStatus && <p>{hoursStatus.label}</p>}
            <p>{formatDeliveryReach(vendor.deliveryRadiusM)}</p>
            <p>{vendor.minOrderKobo > 0 ? `Min. order ${formatNaira(koboOf(vendor.minOrderKobo))}` : "No minimum order"}</p>
            <p>~{vendor.avgPrepMins} min prep time</p>
            {vendor.description && <p className="border-t border-kk-fill pt-2">{vendor.description}</p>}
          </div>
        )}
      </div>

      {/* Identity card */}
      <div className="hidden overflow-hidden rounded-2xl border border-kk-line bg-kk-card shadow-sm lg:block">
        {vendor.bannerUrl && (
          <div className="relative h-24 w-full bg-kk-hair">
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
            <div className="relative size-16 shrink-0 overflow-hidden rounded-2xl border-2 border-white bg-kk-fill shadow-sm">
              {vendor.logoUrl ? (
                <Image
                  src={vendor.logoUrl}
                  alt={vendor.name}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-kk-hair to-kk-fill">
                  <ShoppingBag className="size-6 text-kk-cocoa/40" />
                </div>
              )}
            </div>
          </div>

          <div className="mt-3">
            <h1 className="font-sora text-xl font-bold leading-tight text-kk-ink">
              {vendor.name}
            </h1>
            <p className="mt-0.5 font-inter text-sm text-kk-cocoa">
              {vendor.category || "Various"}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {vendor.isAcceptingOrders ? (
              <Badge className="bg-[rgba(218,53,41,0.1)] text-[#DA3529] hover:bg-[rgba(218,53,41,0.1)]">
                Accepting orders
              </Badge>
            ) : (
              <Badge tone="neutral" className="bg-kk-hair-soft text-kk-cocoa">
                Currently closed
              </Badge>
            )}
            {vendor.ratingCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-kk-fill px-2.5 py-1 font-inter text-xs font-semibold text-kk-ink">
                <Star className="size-3.5 fill-kk-orange text-kk-orange" />
                {vendor.ratingAvg.toFixed(1)}
                <span className="font-normal text-kk-cocoa">
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
                hoursStatus.isOpenNow ? "text-kk-green-ink-ink" : "text-kk-cocoa"
              }`}
            >
              <Clock className="size-4" />
              {hoursStatus.label}
            </div>
          )}
          {vendor.operatingHours === null && (
            <div className="mt-3 flex items-center gap-1.5 font-inter text-sm text-kk-cocoa/70">
              <Clock className="size-4" />
              Hours not set
            </div>
          )}

          {vendor.description && (
            <div className="mt-3 border-t border-kk-fill pt-3">
              <button
                type="button"
                onClick={() => setInfoOpen((v) => !v)}
                className="flex w-full items-center justify-between font-inter text-sm font-semibold text-kk-ink"
              >
                More info
                <ChevronDown
                  className={`size-4 text-kk-cocoa transition-transform ${infoOpen ? "rotate-180" : ""}`}
                />
              </button>
              {infoOpen && (
                <p className="mt-2 font-inter text-sm text-kk-cocoa">
                  {vendor.description}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delivery & order info — real fields, no invented promo content */}
      <div className="hidden rounded-2xl border border-kk-line bg-kk-card p-5 shadow-sm lg:block">
        <h2 className="font-sora text-sm font-semibold text-kk-ink">
          Delivery &amp; order info
        </h2>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-kk-red/10 text-kk-red-ink">
              <Bike className="size-4" />
            </div>
            <span className="font-inter text-sm text-kk-ink">
              {formatDeliveryReach(vendor.deliveryRadiusM)}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-kk-red/10 text-kk-red-ink">
              <Wallet className="size-4" />
            </div>
            <span className="font-inter text-sm text-kk-ink">
              {vendor.minOrderKobo > 0
                ? `Min. order ${formatNaira(koboOf(vendor.minOrderKobo))}`
                : "No minimum order"}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-kk-red/10 text-kk-red-ink">
              <Clock className="size-4" />
            </div>
            <span className="font-inter text-sm text-kk-ink">
              ~{vendor.avgPrepMins} min prep time
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
