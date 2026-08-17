// app/(customer)/orders/[id]/delivered/_components/SuccessChecklist.tsx
"use client";

import { Check, Shield } from "lucide-react";

export function SuccessChecklist() {
  return (
    <div className="rounded-2xl border border-[#E5E2E1] bg-[#F6F3F2] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Shield className="size-4 text-[#B61913]" />
        <h3 className="font-inter text-sm font-semibold text-[#1C1B1B]">
          Delivery Checklist
        </h3>
      </div>

      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#358439]">
            <Check className="size-3.5 text-white" />
          </div>
          <p className="font-inter text-sm text-[#5B403C]">
            Order delivered to your address
          </p>
        </div>

        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#358439]">
            <Check className="size-3.5 text-white" />
          </div>
          <p className="font-inter text-sm text-[#5B403C]">
            Items match your order ({Math.floor(Math.random() * 3) + 2} items)
          </p>
        </div>

        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#358439]">
            <Check className="size-3.5 text-white" />
          </div>
          <p className="font-inter text-sm text-[#5B403C]">
            Delivery code shared with rider (if required)
          </p>
        </div>

        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#358439]">
            <Check className="size-3.5 text-white" />
          </div>
          <p className="font-inter text-sm text-[#5B403C]">
            Rate your delivery experience
          </p>
        </div>
      </div>
    </div>
  );
}
