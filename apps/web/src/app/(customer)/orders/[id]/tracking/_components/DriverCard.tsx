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
    <div className="rounded-xl border border-[#E4BEB8] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 overflow-hidden rounded-full border border-[#E4BEB8] bg-[#DCD9D9]">
          {driver.avatarUrl ? (
            <div
              className="h-full w-full bg-cover bg-center"
              style={{ backgroundImage: `url(${driver.avatarUrl})` }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#DCD9D9] text-2xl">
              <Contact />
            </div>
          )}
        </div>

        <div className="flex-1">
          <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
            {driver.name}
          </p>
          <div className="flex items-center gap-3 text-xs text-[#5B403C]">
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
          className="mt-4 flex items-center justify-center gap-2 rounded-xl border-2 border-[#934B00] py-2 font-inter text-sm font-semibold text-[#934B00] hover:bg-[#F6F3F2]"
        >
          <Phone className="size-3.5" />
          Call {driver.name.split(" ")[0]}
        </a>
      )}
    </div>
  );
}
