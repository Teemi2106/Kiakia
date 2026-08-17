// app/(customer)/orders/[id]/delivered/_components/DeliveredDesktop.tsx
"use client";

import { DeliveryHeader } from "./DeliveryHeader";
import { DeliveryCodeSection } from "./DeliveryCodeSection";
import { SuccessChecklist } from "./SuccessChecklist";
import { Info } from "lucide-react";
import type { Driver } from "./types";

interface DeliveredDesktopProps {
  driver: Driver;
  deliveryCode: string;
}

export function DeliveredDesktop({
  driver,
  deliveryCode,
}: DeliveredDesktopProps) {
  return (
    <div className="mx-auto flex min-h-screen items-center justify-center px-4 py-13">
      <div className="w-full max-w-[480px] overflow-hidden rounded-2xl bg-white shadow-lg">
        {/* Header with Map */}
        <DeliveryHeader driver={driver} />

        {/* Content Area */}
        <div className="max-h-[522px] overflow-y-auto p-4 pb-6">
          {/* Headline */}
          <div className="mb-6 text-center">
            <h1 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.32px] text-[#1C1B1B]">
              Order Delivered!
            </h1>
            <p className="mt-2 font-inter text-base text-[#5B403C]">
              Your order has been successfully delivered.
            </p>
          </div>

          {/* Warning/Reminder Card */}
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-[#FFDCC5] bg-[rgba(255,220,197,0.3)] p-4">
            <Info className="size-5 text-[#934B00]" />
            <div>
              <h4 className="font-inter text-sm font-semibold text-[#1C1B1B]">
                Don&apos;t forget!
              </h4>
              <p className="font-inter text-xs font-medium text-[#5B403C]">
                Rate your delivery experience and help us improve.
              </p>
            </div>
          </div>

          {/* Delivery Code */}
          <DeliveryCodeSection deliveryCode={deliveryCode} />

          {/* Success Checklist */}
          <SuccessChecklist />
        </div>
      </div>
    </div>
  );
}
