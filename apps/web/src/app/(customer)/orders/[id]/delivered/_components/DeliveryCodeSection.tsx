// app/(customer)/orders/[id]/delivered/_components/DeliveryCodeSection.tsx
"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface DeliveryCodeSectionProps {
  deliveryCode: string;
}

export function DeliveryCodeSection({
  deliveryCode,
}: DeliveryCodeSectionProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const digits = deliveryCode.split("");

  return (
    <div className="relative flex flex-col items-center py-4">
      {/* Label */}
      <p className="mb-4 font-inter text-sm font-semibold uppercase tracking-[0.7px] text-kk-cocoa">
        Delivery Code
      </p>

      {/* Code Display */}
      <div className="relative">
        {/* Revealed State */}
        <div
          className={`flex gap-4 transition-opacity ${isRevealed ? "opacity-100" : "opacity-0"}`}
        >
          {digits.map((digit, index) => (
            <div
              key={index}
              className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-kk-ink bg-kk-card shadow-sm"
            >
              <span className="font-sora text-4xl font-extrabold text-kk-ink">
                {digit}
              </span>
            </div>
          ))}
        </div>

        {/* Obfuscated State */}
        <div
          className={`absolute inset-0 flex items-center justify-center gap-4 bg-kk-card transition-opacity ${
            isRevealed ? "opacity-0" : "opacity-100"
          }`}
        >
          {digits.map((_, index) => (
            <div
              key={index}
              className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-kk-hair bg-kk-sand"
            >
              <span className="h-3 w-3 rounded-full bg-[#5B403C]" />
            </div>
          ))}
        </div>
      </div>

      {/* Reveal Button */}
      <button
        onClick={() => setIsRevealed(!isRevealed)}
        className="mt-6 flex items-center gap-2 rounded-xl bg-kk-red px-6 py-3 font-inter text-sm font-semibold text-white shadow-md hover:bg-kk-red-hover"
      >
        {isRevealed ? (
          <>
            <EyeOff className="size-4" />
            Hide Code
          </>
        ) : (
          <>
            <Eye className="size-4" />
            Reveal Code
          </>
        )}
      </button>

      {/* Helper Text */}
      <p className="mt-3 font-inter text-xs font-medium text-kk-cocoa">
        {isRevealed
          ? "Share this code only when your order is delivered"
          : "Tap to reveal your delivery code"}
      </p>
    </div>
  );
}
