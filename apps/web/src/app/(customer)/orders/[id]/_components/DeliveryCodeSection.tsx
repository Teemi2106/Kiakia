// app/(customer)/orders/[id]/_components/DeliveryCodeSection.tsx
"use client";

import { ShieldAlert } from "lucide-react";

interface DeliveryCodeSectionProps {
  deliveryCode: string | null;
}

export function DeliveryCodeSection({
  deliveryCode,
}: DeliveryCodeSectionProps) {
  if (!deliveryCode) return null;

  // Split the code into digits and mask one of them (as per Figma)
  const digits = deliveryCode.split("");
  // Mask the 3rd digit (index 2) with a dash
  const maskedDigits = digits.map((digit, index) => {
    if (index === 2) {
      return { value: "-", isMasked: true };
    }
    return { value: digit, isMasked: false };
  });

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-[#E5E2E1] bg-[#F6F3F2] p-6">
      <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
        Delivery Code
      </h2>

      <div className="flex items-center gap-2">
        {maskedDigits.map((digit, index) => (
          <div
            key={index}
            className={`flex h-16 w-16 items-center justify-center rounded-xl border-2 ${
              digit.isMasked
                ? "border-[#E4BEB8] bg-[#FCF9F8]"
                : "border-[#906F6B] bg-white"
            }`}
          >
            <span className="font-sora text-4xl font-extrabold text-[#1C1B1B]">
              {digit.value}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-lg bg-[rgba(182,25,19,0.1)] px-4 py-2">
        <ShieldAlert className="size-5 text-[#B61913]" />
        <span className="font-inter text-sm font-semibold text-[#B61913]">
          Don&apos;t share this code until your order is delivered
        </span>
      </div>
    </div>
  );
}
