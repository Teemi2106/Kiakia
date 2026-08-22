// app/(vendor)/dashboard/_components/KitchenStatus.tsx
"use client";

import { CookingPot, Truck } from "lucide-react";

export function KitchenStatus() {
  return (
    <div className="rounded-2xl border border-[#E4BEB8] bg-white divide-y divide-[#E4BEB8]">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(147,75,0,0.1)]">
            <CookingPot className="size-5 text-[#934B00]" />
          </div>
          <div>
            <p className="font-inter text-sm font-medium leading-5 text-[#1C1B1B]">
              Preparing Orders
            </p>
            <p className="text-xs text-[#5B403C]">4 items currently on heat</p>
          </div>
        </div>
        <span className="rounded-full bg-[rgba(147,75,0,0.1)] px-3 py-1 text-xs font-bold uppercase text-[#934B00]">
          Busy
        </span>
      </div>

      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(23,106,34,0.1)]">
            <Truck className="size-5 text-[#176A22]" />
          </div>
          <div>
            <p className="font-inter text-sm font-medium leading-5 text-[#1C1B1B]">
              Out for Delivery
            </p>
            <p className="text-xs text-[#5B403C]">
              12 orders being handled by dispatch
            </p>
          </div>
        </div>
        <span className="rounded-full bg-[rgba(23,106,34,0.1)] px-3 py-1 text-xs font-bold uppercase text-[#176A22]">
          Active
        </span>
      </div>
    </div>
  );
}
