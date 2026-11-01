// app/(customer)/cart/_components/PromoCode.tsx
import { Tag } from "lucide-react";

/**
 * There is no promo-code system anywhere in this app yet (no table, no
 * redemption logic, nothing `placeOrderAction` reads). Rather than leave an
 * input + "Apply" button that silently does nothing when used, this is
 * disabled with a "coming soon" label — same treatment as the vendor
 * dashboard's disabled "Withdraw Now" button.
 */
export function PromoCode() {
  return (
    <div className="relative">
      <Tag className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-kk-cocoa/50" />
      <input
        type="text"
        disabled
        aria-disabled="true"
        placeholder="Promo codes coming soon"
        className="h-[49px] w-full cursor-not-allowed rounded-xl border border-kk-hair bg-kk-sand pl-12 pr-24 font-inter text-base text-kk-cocoa/50 placeholder:text-kk-cocoa/50"
      />
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Coming soon"
        className="absolute right-2 top-1/2 -translate-y-1/2 cursor-not-allowed rounded-lg bg-kk-hair-soft px-4 py-1.5 font-inter text-sm font-semibold text-kk-cocoa/50"
      >
        Apply
      </button>
    </div>
  );
}
