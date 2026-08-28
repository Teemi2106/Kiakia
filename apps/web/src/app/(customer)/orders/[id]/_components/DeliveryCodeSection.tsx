// app/(customer)/orders/[id]/_components/DeliveryCodeSection.tsx
"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, ShieldAlert, Share2Icon } from "lucide-react";

interface DeliveryCodeSectionProps {
  deliveryCode: string | null;
}

/**
 * `deliveryCode` here is the real, live code from order_delivery_codes
 * (cryptographically random, pgcrypto's gen_random_bytes — 0022_delivery_code_off_orders.sql),
 * RLS-scoped to this order's own customer — never a placeholder. This used
 * to permanently overwrite the 3rd digit with a static "-" ("as per
 * Figma"), which threw away a real digit of the customer's own code rather
 * than masking anything meaningful (RLS already restricts who can read it
 * at all) — the customer couldn't actually read the full code out to a
 * rider. Replaced with a reveal/hide toggle (same pattern as
 * orders/[id]/delivered/_components/DeliveryCodeSection.tsx) that shows
 * every digit, just hidden-by-default so it isn't visible at a glance.
 */
export function DeliveryCodeSection({
  deliveryCode,
}: DeliveryCodeSectionProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [justCopied, setJustCopied] = useState(false);

  useEffect(() => {
    if (!justCopied) return;
    const timer = setTimeout(() => setJustCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [justCopied]);

  if (!deliveryCode) return null;

  const digits = deliveryCode.split("");

  async function handleShare() {
    if (!deliveryCode) return;
    const text = `My KiaKia delivery code is ${deliveryCode} — please only use this once my order has arrived.`;

    if (navigator.share) {
      try {
        await navigator.share({ title: "KiaKia delivery code", text });
      } catch {
        // AbortError (user cancelled the share sheet) or any other failure —
        // nothing to recover from, and definitely not a crash.
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(deliveryCode);
      setJustCopied(true);
    } catch {
      // Clipboard access can be denied (permissions, insecure context) —
      // leave the button as-is rather than throwing.
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-[#E5E2E1] bg-[#F6F3F2] p-6">
      <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
        Delivery Code
      </h2>

      <div className="relative">
        <div className={`flex items-center gap-2 transition-opacity ${isRevealed ? "opacity-100" : "opacity-0"}`}>
          {digits.map((digit, index) => (
            <div
              key={index}
              className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-[#906F6B] bg-white"
            >
              <span className="font-sora text-4xl font-extrabold text-[#1C1B1B]">
                {digit}
              </span>
            </div>
          ))}
        </div>

        <div
          className={`absolute inset-0 flex items-center gap-2 transition-opacity ${
            isRevealed ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          {digits.map((_, index) => (
            <div
              key={index}
              className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-[#E4BEB8] bg-[#FCF9F8]"
            >
              <span className="h-3 w-3 rounded-full bg-[#906F6B]" />
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setIsRevealed((prev) => !prev)}
        className="flex items-center gap-2 rounded-xl bg-[#B61913] px-5 py-2.5 font-inter text-sm font-semibold text-white hover:bg-[#9e1611]"
      >
        {isRevealed ? (
          <>
            <EyeOff className="size-4" />
            Hide code
          </>
        ) : (
          <>
            <Eye className="size-4" />
            Reveal code
          </>
        )}
      </button>

      <div className="flex items-center gap-2 rounded-lg bg-[rgba(182,25,19,0.1)] px-4 py-2">
        <ShieldAlert className="size-5 text-[#B61913]" />
        <span className="font-inter text-sm font-semibold text-[#B61913]">
          Don&apos;t share this code until your order is delivered
        </span>
      </div>

      <button
        type="button"
        onClick={() => void handleShare()}
        className="flex items-center gap-2 font-inter text-sm text-[#5B403C] hover:text-[#1C1B1B] hover:underline"
      >
        <Share2Icon className="size-4" />
        {justCopied ? "Copied to clipboard" : "Share code"}
      </button>
    </div>
  );
}
