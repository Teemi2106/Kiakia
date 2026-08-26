// app/(customer)/tracking/_components/TrackingDesktop.tsx
"use client";

import type { OrderStatus } from "@kiakia/domain";
import { DeliveryCodeSection } from "../../delivered/_components/DeliveryCodeSection";
import { Timeline } from "./Timeline";
import { DriverCard } from "./DriverCard";
import { VendorCard } from "./VendorCard";
import { MapArea } from "./MapArea";
import { isTrackingTerminal, trackingHeadline } from "./statusCopy";
import type { TimelineStep, Driver, Vendor } from "./types";

interface TrackingDesktopProps {
  steps: TimelineStep[];
  driver?: Driver;
  vendor: Vendor;
  orderId?: string;
  orderCode: string;
  status: OrderStatus;
  /** Only passed by the page when status is in_transit/arrived — see page.tsx. */
  deliveryCode?: string;
}

export function TrackingDesktop({
  steps,
  driver,
  vendor,
  orderId,
  orderCode,
  status,
  deliveryCode,
}: TrackingDesktopProps) {
  const isLive = !isTrackingTerminal(status) && status !== "delivered";

  return (
    <div className="flex h-screen">
      {/* Left Sidebar - Details Panel */}
      <div className="w-[420px] shrink-0 border-r border-[#E4BEB8] bg-[#FCF9F8] shadow-[8px_0px_24px_rgba(26,26,26,0.05)]">
        {/* Header Status */}
        <div className="border-b border-[#F6F3F2] p-4 pb-6">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-inter text-xs font-semibold uppercase tracking-[0.7px] text-[#5B403C]">
              Order #{orderCode}
            </span>
            {isLive && (
              <div className="flex items-center gap-1 rounded-full bg-[rgba(182,25,19,0.1)] px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-[#B61913]" />
                <span className="font-inter text-xs font-bold text-[#B61913]">
                  Live
                </span>
              </div>
            )}
          </div>
          <h1 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.32px] text-[#1C1B1B]">
            {trackingHeadline(status)}
          </h1>
          <p className="font-inter text-base text-[#5B403C]">
            We&apos;ll update this page automatically as your order moves.
          </p>
        </div>

        {/* Scrollable Content */}
        <div className="h-[calc(100vh-141px)] overflow-y-auto p-6">
          <div className="space-y-8">
            {/* Delivery Code — the rider needs this to confirm delivery
                (verify_delivery_and_release_escrow), so it's shown while the
                order is actually en route, not only after the fact. */}
            {deliveryCode && (
              <div className="rounded-xl border border-[#E4BEB8] bg-white shadow-sm">
                <DeliveryCodeSection deliveryCode={deliveryCode} />
              </div>
            )}

            {/* Timeline - Pass orderId */}
            <Timeline steps={steps} orderId={orderId} />

            {/* Driver Card — a rider isn't assigned until dispatch runs
                (Phase 3, not built), so this is omitted rather than shown
                with fabricated details when there's no rider yet. */}
            {driver ? (
              <DriverCard driver={driver} />
            ) : (
              <div className="rounded-xl border border-[#E4BEB8] bg-white p-4 text-center text-sm text-[#5B403C] shadow-sm">
                Waiting for a rider to be assigned…
              </div>
            )}

            {/* Vendor Card */}
            <VendorCard vendor={vendor} />
          </div>
        </div>
      </div>

      {/* Right Side - Map Area */}
      <div className="flex-1">
        <MapArea variant="desktop" hasRider={Boolean(driver)} />
      </div>
    </div>
  );
}
