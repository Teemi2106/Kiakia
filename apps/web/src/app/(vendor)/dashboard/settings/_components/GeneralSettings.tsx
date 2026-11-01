// app/(vendor)/settings/_components/GeneralSettings.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Clock, MapPin, Store, TrendingUp } from "lucide-react";
import { MarketingPreferences } from "@/app/_components/MarketingPreferences";
import { SettingsForm } from "../_components/SettingsForm";
import type { VendorSettings } from "./types";

interface GeneralSettingsProps {
  vendor: VendorSettings;
}

export function GeneralSettings({ vendor }: GeneralSettingsProps) {
  return (
    <div className="space-y-6">
      {/* Store Info Card */}
      <div className="rounded-2xl border border-kk-line bg-kk-card p-6 shadow-sm">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-sora text-2xl font-semibold text-kk-ink">
              General Information
            </h2>
            <p className="text-sm text-kk-cocoa">
              Manage your store details and preferences
            </p>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-notice-surface">
            <Store className="size-5 text-kk-orange-ink" />
          </div>
        </div>

        <SettingsForm vendor={vendor} />
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-kk-line bg-kk-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-kk-cocoa">
            <Clock className="size-4" />
            Prep Time
          </div>
          <p className="mt-1 font-sora text-xl font-bold text-kk-ink">
            {vendor.avgPrepMins} min
          </p>
        </div>
        <div className="rounded-2xl border border-kk-line bg-kk-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-kk-cocoa">
            <TrendingUp className="size-4" />
            Min. Order
          </div>
          <p className="mt-1 font-sora text-xl font-bold text-kk-ink">
            {formatNaira(koboOf(vendor.minOrderKobo))}
          </p>
        </div>
        <div className="rounded-2xl border border-kk-line bg-kk-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-kk-cocoa">
            <MapPin className="size-4" />
            Delivery Radius
          </div>
          <p className="mt-1 font-sora text-xl font-bold text-kk-ink">
            {(vendor.deliveryRadiusM / 1000).toFixed(1)} km
          </p>
        </div>
      </div>

      <MarketingPreferences initial={vendor.marketing} />
    </div>
  );
}
