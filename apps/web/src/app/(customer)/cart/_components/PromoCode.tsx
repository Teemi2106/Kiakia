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
      <Tag className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#5B403C]/50" />
      <input
        type="text"
        disabled
        aria-disabled="true"
        placeholder="Promo codes coming soon"
        className="h-[49px] w-full cursor-not-allowed rounded-xl border border-[#E5E2E1] bg-[#F6F3F2] pl-12 pr-24 font-inter text-base text-[#5B403C]/50 placeholder:text-[#5B403C]/50"
      />
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Coming soon"
        className="absolute right-2 top-1/2 -translate-y-1/2 cursor-not-allowed rounded-lg bg-[#EAE7E7] px-4 py-1.5 font-inter text-sm font-semibold text-[#5B403C]/50"
      >
        Apply
      </button>
    </div>
  );
}
