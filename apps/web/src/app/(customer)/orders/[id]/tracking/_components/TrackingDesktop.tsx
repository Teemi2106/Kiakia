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
    // Sized against the viewport minus the fixed customer chrome, which
    // (customer)/layout.tsx publishes as --kk-nav-h/--kk-tabbar-h. `h-screen`
    // here used to overflow the page by exactly the header's height.
    <div className="flex h-[calc(100vh-var(--kk-nav-h,0px)-var(--kk-tabbar-h,0px))]">
      {/* Left Sidebar - Details Panel */}
      <div className="flex w-[420px] shrink-0 flex-col border-r border-[#E4BEB8] bg-[#FCF9F8] shadow-[8px_0px_24px_rgba(26,26,26,0.05)]">
        {/* Header Status */}
        <div className="shrink-0 border-b border-[#F6F3F2] p-4 pb-6">
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
        {/* Fills whatever the header block leaves, rather than a hard-coded
            100vh-141px that assumed one particular header height. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
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

            {/* Driver Card — dispatch (0019/0023/0026_rider_self_service.sql)
                is fully built, but a rider may still not be assigned to
                THIS order yet (e.g. still `placed`/`preparing`), so this is
                omitted rather than shown with fabricated details when
                `driver` is unset. */}
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

      {/* Right Side - Map Area — vendor/destination/rider markers and their
          live movement come from get_order_tracking() + Realtime
          (0026/0027_*.sql, dispatch is fully built), not from whether a
          `driver` record is present. */}
      {/* min-w-0 so the map column can actually shrink; MapArea fills it. */}
      <div className="min-w-0 flex-1">
        <MapArea variant="desktop" orderId={orderId} status={status} />
      </div>
    </div>
  );
}
