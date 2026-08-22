// app/(vendor)/settings/_components/DeliveryZone.tsx
"use client";

import { useState } from "react";
import { MapPin, Info, TrendingUp } from "lucide-react";

export function DeliveryZone() {
  const [radius, setRadius] = useState(8);
  const [deliveryFee, setDeliveryFee] = useState(1500);
  const [minOrder, setMinOrder] = useState(3500);

  return (
    <div className="rounded-xl border border-[#E4BEB8] bg-white overflow-hidden">
      <div className="p-6">
        <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
          Delivery Zone
        </h2>
        <p className="mb-6 text-sm text-[#5B403C]">
          Manage how far your couriers will travel.
        </p>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Controls */}
          <div className="space-y-4">
            <div>
              <label className="mb-2 block font-inter text-sm font-medium text-[#1C1B1B]">
                Maximum Radius (km)
              </label>
              <div className="relative">
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={radius}
                  onChange={(e) => setRadius(parseInt(e.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#F0EDED] accent-[#B61913]"
                />
                <div className="mt-2 flex justify-between text-sm text-[#5B403C]">
                  <span>1km</span>
                  <span className="font-bold text-[#B61913]">{radius}km</span>
                  <span>20km</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[rgba(147,75,0,0.2)] bg-[rgba(255,220,197,0.3)] p-4">
              <div className="flex items-center gap-3 text-[#653200]">
                <Info className="size-5 shrink-0" />
                <p className="text-sm">
                  Orders beyond 5km will incur an automatic 15% surcharge for
                  distance.
                </p>
              </div>
            </div>

            <div>
              <label className="mb-2 block font-inter text-sm font-medium text-[#1C1B1B]">
                Base Delivery Fee
              </label>
              <div className="flex items-center">
                <span className="rounded-l-xl border border-r-0 border-[#E4BEB8] bg-[#F6F3F2] px-3 py-2 font-inter text-sm">
                  ₦
                </span>
                <input
                  type="number"
                  value={deliveryFee}
                  onChange={(e) => setDeliveryFee(parseInt(e.target.value))}
                  className="w-full rounded-r-xl border border-[#E4BEB8] p-2 font-inter text-sm focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block font-inter text-sm font-medium text-[#1C1B1B]">
                Minimum Order Value
              </label>
              <div className="flex items-center">
                <span className="rounded-l-xl border border-r-0 border-[#E4BEB8] bg-[#F6F3F2] px-3 py-2 font-inter text-sm">
                  ₦
                </span>
                <input
                  type="number"
                  value={minOrder}
                  onChange={(e) => setMinOrder(parseInt(e.target.value))}
                  className="w-full rounded-r-xl border border-[#E4BEB8] p-2 font-inter text-sm focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
                />
              </div>
            </div>
          </div>

          {/* Map Placeholder */}
          <div className="relative min-h-[250px] overflow-hidden rounded-xl border border-[#E4BEB8] bg-[#F0EDED]">
            <div className="flex h-full w-full items-center justify-center bg-cover bg-center">
              <div className="relative z-10 rounded-full bg-white/90 px-4 py-2 shadow-sm backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <MapPin className="size-5 text-[#B61913]" />
                  <span className="font-inter text-sm font-medium text-[#1C1B1B]">
                    Kitchen Location
                  </span>
                </div>
              </div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-48 w-48 animate-pulse rounded-full border-4 border-[rgba(182,25,19,0.2)] bg-[rgba(182,25,19,0.05)]" />
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button className="rounded-xl px-6 py-2 font-inter text-sm font-medium text-[#5B403C] transition-colors hover:bg-[#F6F3F2]">
            Reset to Default
          </button>
          <button className="rounded-xl bg-[#B61913] px-6 py-2 font-inter text-sm font-medium text-white transition-colors hover:bg-[#9e1611]">
            Update Delivery Terms
          </button>
        </div>
      </div>
    </div>
  );
}
