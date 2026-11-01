// app/(customer)/orders/[id]/delivered/_components/SuccessChecklist.tsx
"use client";

import { Check, Shield } from "lucide-react";

interface SuccessChecklistProps {
  itemCount: number;
}

export function SuccessChecklist({ itemCount }: SuccessChecklistProps) {
  return (
    <div className="rounded-2xl border border-kk-hair bg-kk-sand p-4">
      <div className="mb-3 flex items-center gap-2">
        <Shield className="size-4 text-kk-red-ink" />
        <h3 className="font-inter text-sm font-semibold text-kk-ink">
          Delivery Checklist
        </h3>
      </div>

      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-kk-green-mid">
            <Check className="size-3.5 text-white" />
          </div>
          <p className="font-inter text-sm text-kk-cocoa">
            Order delivered to your address
          </p>
        </div>

        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-kk-green-mid">
            <Check className="size-3.5 text-white" />
          </div>
          <p className="font-inter text-sm text-kk-cocoa">
            Items match your order ({itemCount} {itemCount === 1 ? "item" : "items"})
          </p>
        </div>

        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-kk-green-mid">
            <Check className="size-3.5 text-white" />
          </div>
          <p className="font-inter text-sm text-kk-cocoa">
            Delivery code shared with rider (if required)
          </p>
        </div>

        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-kk-green-mid">
            <Check className="size-3.5 text-white" />
          </div>
          <p className="font-inter text-sm text-kk-cocoa">
            Rate your delivery experience
          </p>
        </div>
      </div>
    </div>
  );
}
