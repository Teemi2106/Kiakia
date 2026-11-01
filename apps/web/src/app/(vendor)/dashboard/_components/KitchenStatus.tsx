// app/(vendor)/dashboard/_components/KitchenStatus.tsx
"use client";

import { CookingPot, Truck } from "lucide-react";

interface KitchenStatusProps {
  preparingCount: number;
  dispatchCount: number;
}

export function KitchenStatus({ preparingCount, dispatchCount }: KitchenStatusProps) {
  return (
    <div className="rounded-2xl border border-kk-line bg-kk-card divide-y divide-kk-line">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(147,75,0,0.1)]">
            <CookingPot className="size-5 text-kk-orange-ink" />
          </div>
          <div>
            <p className="font-inter text-sm font-medium leading-5 text-kk-ink">
              Preparing Orders
            </p>
            <p className="text-xs text-kk-cocoa">
              {preparingCount} order{preparingCount === 1 ? "" : "s"} currently
              in the kitchen
            </p>
          </div>
        </div>
        <span className="rounded-full bg-[rgba(147,75,0,0.1)] px-3 py-1 text-xs font-bold uppercase text-kk-orange-ink">
          {preparingCount > 0 ? "Busy" : "Idle"}
        </span>
      </div>

      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(23,106,34,0.1)]">
            <Truck className="size-5 text-kk-green-ink" />
          </div>
          <div>
            <p className="font-inter text-sm font-medium leading-5 text-kk-ink">
              Out for Delivery
            </p>
            <p className="text-xs text-kk-cocoa">
              {dispatchCount} order{dispatchCount === 1 ? "" : "s"} being
              handled by dispatch
            </p>
          </div>
        </div>
        <span className="rounded-full bg-[rgba(23,106,34,0.1)] px-3 py-1 text-xs font-bold uppercase text-kk-green-ink">
          {dispatchCount > 0 ? "Active" : "Idle"}
        </span>
      </div>
    </div>
  );
}
