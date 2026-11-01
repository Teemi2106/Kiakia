// app/(customer)/orders/[id]/delivered/_components/DeliveredMobile.tsx
"use client";

import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Check,
  Shield,
  Phone,
  MessageCircle,
  Contact,
  Info,
} from "lucide-react";
import { DeliveryCodeSection } from "./DeliveryCodeSection";
import type { Driver } from "./types";

interface DeliveredMobileProps {
  driver?: Driver;
  deliveryCode?: string;
}

export function DeliveredMobile({
  driver,
  deliveryCode,
}: DeliveredMobileProps) {
  const router = useRouter();

  return (
    <div className="flex min-h-screen pb-8 flex-col bg-kk-cream">
      {/* Header with Back Button */}
      <header className="sticky top-0 z-10 bg-kk-cream px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="rounded-lg p-2 hover:bg-black/5"
            aria-label="Go back"
          >
            <ChevronLeft className="size-5 text-kk-ink" />
          </button>
          <h1 className="font-sora text-2xl font-bold text-kk-ink">
            Order Delivered
          </h1>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto pb-8">
        {/* Map/Header Image */}
        <div className="relative h-48 w-full bg-kk-hair-soft">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: "url('/assets/delivery-map-placeholder.png')",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-white to-transparent" />

          {/* Driver Info Overlay — omitted when no rider is assigned
              (dispatch is Phase 3, not built yet), rather than shown with
              fabricated details. */}
          {driver && (
            <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-[rgba(228,190,184,0.3)] bg-kk-card/90 p-3 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 overflow-hidden rounded-full border-2 border-white bg-kk-hair">
                    <div className="flex h-full w-full items-center justify-center bg-kk-hair text-lg">
                      <Contact className="size-5 text-kk-cocoa" />
                    </div>
                  </div>
                  <div>
                    <p className="font-inter text-sm font-semibold text-kk-ink">
                      {driver.name}
                    </p>
                    <p className="font-inter text-xs font-medium text-kk-cocoa">
                      {[driver.vehicle, driver.plateNumber].filter(Boolean).join(" • ")}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="rounded-full bg-kk-fill p-2">
                    <Phone className="size-4 text-kk-red-ink" />
                  </button>
                  <button className="rounded-full bg-kk-fill p-2">
                    <MessageCircle className="size-4 text-kk-red-ink" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="px-4 pt-6">
          {/* Status Badge */}
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-notice-surface bg-[rgba(255,220,197,0.2)] px-3 py-2">
            <Info className="size-4 text-[#b69013]" />
            <span className="font-inter text-xs text-center font-semibold uppercase tracking-[0.7px] text-[#703800]">
              {driver ? `${driver.name} has successfully arrived` : "Your order has arrived"}
            </span>
          </div>

          {/* Headline */}
          <h1 className="font-sora text-[28px] text-center font-bold leading-[34px] text-kk-ink">
            Order Delivered!
          </h1>
          <p className="mt-2 font-inter text-center text-lg text-kk-cocoa">
            Your order has been successfully delivered.
          </p>

          {/* Delivery Code — 0011_delivery_code.sql: genuine per-order code,
              omitted for pre-migration orders that never got one. */}
          {deliveryCode && <DeliveryCodeSection deliveryCode={deliveryCode} />}

          {/* Divider */}
          <div className="my-6 h-px bg-kk-hair-soft" />

          {/* Checklist */}
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
                  Items match your order
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-kk-green-mid">
                  <Check className="size-3.5 text-white" />
                </div>
                <p className="font-inter text-sm text-kk-cocoa">
                  Delivery code shared with rider
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
