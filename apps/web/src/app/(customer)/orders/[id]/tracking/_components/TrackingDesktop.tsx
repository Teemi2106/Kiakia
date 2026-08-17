// app/(customer)/tracking/_components/TrackingDesktop.tsx
"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Timeline } from "./Timeline";
import { DriverCard } from "./DriverCard";
import { VendorCard } from "./VendorCard";
import { MapArea } from "./MapArea";
import type { TimelineStep, Driver, Vendor } from "./types";

interface TrackingDesktopProps {
  steps: TimelineStep[];
  driver: Driver;
  vendor: Vendor;
  orderId?: string; // Add orderId
}

export function TrackingDesktop({
  steps,
  driver,
  vendor,
  orderId,
}: TrackingDesktopProps) {
  return (
    <div className="flex h-screen">
      {/* Left Sidebar - Details Panel */}
      <div className="w-[420px] shrink-0 border-r border-[#E4BEB8] bg-[#FCF9F8] shadow-[8px_0px_24px_rgba(26,26,26,0.05)]">
        {/* Header Status */}
        <div className="border-b border-[#F6F3F2] p-4 pb-6">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-inter text-xs font-semibold uppercase tracking-[0.7px] text-[#5B403C]">
              Order #12345
            </span>
            <div className="flex items-center gap-1 rounded-full bg-[rgba(182,25,19,0.1)] px-3 py-1">
              <span className="h-2 w-2 rounded-full bg-[#B61913]" />
              <span className="font-inter text-xs font-bold text-[#B61913]">
                Live
              </span>
            </div>
          </div>
          <h1 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.32px] text-[#1C1B1B]">
            Arriving in 12 min
          </h1>
          <p className="font-inter text-base text-[#5B403C]">
            Estimated arrival: 7:45 PM
          </p>
        </div>

        {/* Scrollable Content */}
        <div className="h-[calc(100vh-141px)] overflow-y-auto p-6">
          <div className="space-y-8">
            {/* Timeline - Pass orderId */}
            <Timeline steps={steps} orderId={orderId} />

            {/* Driver Card */}
            <DriverCard driver={driver} />

            {/* Vendor Card */}
            <VendorCard vendor={vendor} />
          </div>
        </div>
      </div>

      {/* Right Side - Map Area */}
      <div className="flex-1">
        <MapArea variant="desktop" />
      </div>
    </div>
  );
}
