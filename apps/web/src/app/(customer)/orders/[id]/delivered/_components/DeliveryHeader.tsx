// app/(customer)/orders/[id]/delivered/_components/DeliveryHeader.tsx
"use client";

import { Phone, MessageCircle, Contact2 } from "lucide-react";

interface DeliveryHeaderProps {
  driver?: {
    name: string;
    vehicle?: string;
    plateNumber?: string;
    avatarUrl?: string;
  };
}

export function DeliveryHeader({ driver }: DeliveryHeaderProps) {
  return (
    <div className="relative h-64 w-full bg-kk-hair-soft">
      {/* Map/Image Background */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: "url('/assets/delivery-map-placeholder.png')",
        }}
      />

      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-white to-transparent" />

      {/* Status Pill */}
      <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full bg-kk-card px-3 py-1.5 shadow-sm">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-kk-red opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-kk-red" />
        </span>
        <span className="font-inter text-sm font-semibold text-kk-red-ink">
          Delivered
        </span>
      </div>

      {/* Driver Info Overlay — omitted when no rider is assigned (dispatch
          is Phase 3, not built yet), rather than shown with fabricated
          details. */}
      {driver && (
        <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-[rgba(228,190,184,0.3)] bg-kk-card/90 p-3 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Avatar */}
              <div className="h-12 w-12 overflow-hidden rounded-full border-2 border-white bg-kk-hair">
                {driver.avatarUrl ? (
                  <div
                    className="h-full w-full bg-cover bg-center"
                    style={{ backgroundImage: `url(${driver.avatarUrl})` }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-kk-hair text-xl">
                    <Contact2 className="size-5 text-kk-cocoa" />
                  </div>
                )}
              </div>

              {/* Driver Info */}
              <div>
                <p className="font-inter text-sm font-semibold text-kk-ink">
                  {driver.name}
                </p>
                <p className="font-inter text-xs font-medium text-kk-cocoa">
                  {[driver.vehicle, driver.plateNumber].filter(Boolean).join(" • ")}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <button className="rounded-full bg-kk-fill p-2.5 hover:bg-kk-fill-mid">
                <Phone className="size-5 text-kk-red-ink" />
              </button>
              <button className="rounded-full bg-kk-fill p-2.5 hover:bg-kk-fill-mid">
                <MessageCircle className="size-[18px] text-kk-red-ink" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
