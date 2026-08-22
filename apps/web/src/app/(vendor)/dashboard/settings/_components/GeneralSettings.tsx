// app/(vendor)/settings/_components/GeneralSettings.tsx
"use client";

import { Card } from "@kiakia/ui";
import { Store, MapPin, Clock, TrendingUp } from "lucide-react";
import { SettingsForm } from "../_components/SettingsForm";
import type { VendorSettings } from "./types";

interface GeneralSettingsProps {
  vendor: VendorSettings;
}

export function GeneralSettings({ vendor }: GeneralSettingsProps) {
  return (
    <div className="space-y-6">
      {/* Store Info Card */}
      <div className="rounded-xl border border-[#E4BEB8] bg-white p-6">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
              General Information
            </h2>
            <p className="text-sm text-[#5B403C]">
              Manage your store details and preferences
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFDCC5]">
            <Store className="size-5 text-[#934B00]" />
          </div>
        </div>

        <SettingsForm vendor={vendor} />
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-[#E4BEB8] bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-[#5B403C]">
            <Clock className="size-4" />
            Prep Time
          </div>
          <p className="mt-1 font-sora text-xl font-bold text-[#1C1B1B]">
            {vendor.avgPrepMins} min
          </p>
        </div>
        <div className="rounded-xl border border-[#E4BEB8] bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-[#5B403C]">
            <TrendingUp className="size-4" />
            Min. Order
          </div>
          <p className="mt-1 font-sora text-xl font-bold text-[#1C1B1B]">
            ₦{vendor.minOrderKobo / 100}
          </p>
        </div>
      </div>
    </div>
  );
}
