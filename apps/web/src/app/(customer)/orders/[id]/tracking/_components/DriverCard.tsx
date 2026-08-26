// app/(customer)/tracking/_components/DriverCard.tsx
"use client";

import { Phone, MessageCircle, Contact } from "lucide-react";

interface DriverCardProps {
  driver: {
    name: string;
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

      <div className="mt-4 flex gap-3">
        <button className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-[#934B00] py-2 font-inter text-sm font-semibold text-[#934B00] hover:bg-[#F6F3F2]">
          <Phone className="size-3.5" />
          Call
        </button>
        <button className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-[#934B00] py-2 font-inter text-sm font-semibold text-[#934B00] hover:bg-[#F6F3F2]">
          <MessageCircle className="size-3.5" />
          Message
        </button>
      </div>
    </div>
  );
}
