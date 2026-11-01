// app/(customer)/tracking/_components/DriverCard.tsx
"use client";

import { Phone, Contact } from "lucide-react";

interface DriverCardProps {
  driver: {
    name: string;
    phone?: string;
    plateNumber?: string;
    avatarUrl?: string;
    car?: string;
  };
}

export function DriverCard({ driver }: DriverCardProps) {
  return (
    <div className="rounded-xl border border-kk-line bg-kk-card p-4 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 overflow-hidden rounded-full border border-kk-line bg-kk-fill-deep">
          {driver.avatarUrl ? (
            <div
              className="h-full w-full bg-cover bg-center"
              style={{ backgroundImage: `url(${driver.avatarUrl})` }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-kk-fill-deep text-2xl">
              <Contact />
            </div>
          )}
        </div>

        <div className="flex-1">
          <p className="font-inter text-sm font-semibold text-kk-ink">
            {driver.name}
          </p>
          <div className="flex items-center gap-3 text-xs text-kk-cocoa">
            {driver.car && <span>{driver.car}</span>}
            {driver.plateNumber && <span>Plate: {driver.plateNumber}</span>}
          </div>
        </div>
      </div>

      {/* No in-app messaging channel exists anywhere in this codebase — a
          "Message" button here would be dead UI, same reasoning this app
          avoids fabricating any other feature that isn't actually built.
          `tel:` is real: it hands off to whatever calling app the device
          already has. Omitted entirely (not disabled) when the rider's
          number is unset — get_order_tracking() (0071) can return
          rider_phone: null even once a rider is assigned, if their own
          profile has no phone on file. */}
      {driver.phone && (
        <a
          href={`tel:${driver.phone}`}
          className="mt-4 flex items-center justify-center gap-2 rounded-xl border-2 border-kk-orange-ink py-2 font-inter text-sm font-semibold text-kk-orange-ink hover:bg-kk-sand"
        >
          <Phone className="size-3.5" />
          Call {driver.name.split(" ")[0]}
        </a>
      )}
    </div>
  );
}
