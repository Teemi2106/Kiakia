// app/(customer)/tracking/_components/TrackingMobile.tsx
"use client";

import {
  ChevronLeft,
  Phone,
  MessageCircle,
  MapPin,
  ContactRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { MapArea } from "./MapArea";
import Link from "next/link";
import type { OrderStatus } from "@kiakia/domain";
import { DeliveryCodeSection } from "../../delivered/_components/DeliveryCodeSection";
import { trackingHeadline } from "./statusCopy";
import type { TimelineStep, Driver, Vendor } from "./types";

interface TrackingMobileProps {
  steps: TimelineStep[];
  driver?: Driver;
  vendor: Vendor;
  orderId?: string; // Add orderId
  orderCode: string;
  status: OrderStatus;
  /** Only passed by the page when status is in_transit/arrived — see page.tsx. */
  deliveryCode?: string;
}

export function TrackingMobile({
  steps,
  driver,
  vendor,
  orderId,
  orderCode,
  status,
  deliveryCode,
}: TrackingMobileProps) {
  const router = useRouter();

  return (
    <div className="relative h-[calc(100vh-136px)] w-full overflow-hidden">
      {/* Map Layer */}
      <div className="absolute inset-0">
        <MapArea variant="mobile" hasRider={Boolean(driver)} />
      </div>

      {/* Back Button */}
      <button
        onClick={() => router.back()}
        className="absolute left-4 top-4 z-10 rounded-full bg-[rgba(252,249,248,0.9)] p-3 shadow-lg backdrop-blur-sm"
        aria-label="Go back"
      >
        <ChevronLeft className="size-5 text-[#1C1B1B]" />
      </button>

      {/* Bottom Sheet */}
      <div className="absolute bottom-0 left-0 right-0 z-10">
        <div className="rounded-t-2xl border border-[#EAE7E7] bg-[#FCF9F8] px-4 pb-6 pt-3 shadow-[0_-8px_32px_rgba(26,26,26,0.08)]">
          {/* Drag Handle */}
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#E5E2E1]" />

          {/* Status */}
          <div className="mb-4 text-center">
            <h2 className="font-sora text-[28px] font-bold text-[#B61913]">
              {trackingHeadline(status)}
            </h2>
            <p className="font-inter text-sm font-semibold text-[#5B403C]">
              Order #{orderCode}
            </p>
          </div>

          {/* Delivery Code — the rider needs this to confirm delivery
              (verify_delivery_and_release_escrow), so it's shown while the
              order is actually en route, not only after the fact. */}
          {deliveryCode && (
            <div className="mb-4 rounded-xl border border-[#F0EDED] bg-white shadow-sm">
              <DeliveryCodeSection deliveryCode={deliveryCode} />
            </div>
          )}

          {/* Timeline Steps (Mobile) */}
          <div className="mb-4 flex items-center justify-between px-2">
            {steps.map((step) => {
              const isActive = step.status === "active";
              const isDone = step.status === "done";
              const isPending = step.status === "pending";

              return (
                <div key={step.id} className="flex flex-col items-center">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#FCF9F8] ${
                      isDone || isActive ? "bg-[#B61913]" : "bg-[#E5E2E1]"
                    } ${isActive ? "shadow-[0_0_0_4px_rgba(182,25,19,0.1)]" : ""}`}
                  >
                    {isDone && <span className="h-1.5 w-2 bg-white" />}
                    {isActive && (
                      <span className="h-3 w-3 rounded-full bg-[#B61913]" />
                    )}
                  </div>
                  <span
                    className={`mt-1 text-[10px] font-medium ${
                      isActive ? "text-[#B61913]" : "text-[#5B403C]"
                    } ${isPending ? "text-[#DCD9D9]" : ""}`}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* View Delivery Status Button - Mobile */}
          {orderId && (
            <Link
              href={`/orders/${orderId}/delivered`}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#B61913] py-3 font-inter text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#9e1611]"
            >
              <MapPin className="size-4" />
              View Delivery Details
            </Link>
          )}

          {/* Divider */}
          <div className="mb-4 h-px w-full bg-[#EAE7E7]" />

          {/* Driver Info — a rider isn't assigned until dispatch runs
              (Phase 3, not built), so this is omitted rather than shown
              with fabricated details when there's no rider yet. */}
          {driver ? (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-[#F0EDED] bg-white p-3 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 overflow-hidden rounded-full bg-[#EAE7E7]">
                  <div className="flex h-full w-full items-center justify-center bg-[#EAE7E7] text-xl">
                    <ContactRound />
                  </div>
                </div>
                <div>
                  <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
                    {driver.name}
                  </p>
                  <p className="font-inter text-xs text-[#5B403C]">
                    {[driver.car, driver.plateNumber].filter(Boolean).join(" ")}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="rounded-full bg-[#DA3529] p-2.5">
                  <Phone className="size-4 text-white" />
                </button>
                <button className="rounded-full bg-[#DA3529] p-2.5">
                  <MessageCircle className="size-4 text-white" />
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-4 rounded-xl border border-[#F0EDED] bg-white p-3 text-center text-sm text-[#5B403C] shadow-sm">
              Waiting for a rider to be assigned…
            </div>
          )}

          {/* Vendor Info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EAE7E7]">
                <MapPin className="size-5 text-[#B61913]" />
              </div>
              <div>
                <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
                  {vendor.name}
                </p>
                <p className="font-inter text-xs text-[#5B403C]">
                  {vendor.itemCount} items
                </p>
              </div>
            </div>
            <button className="font-inter text-sm font-semibold text-[#B61913] hover:underline">
              View Menu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
