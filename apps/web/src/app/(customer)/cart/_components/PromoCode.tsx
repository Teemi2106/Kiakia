// app/(auth)/customer/cart/_components/PromoCode.tsx
import { Tag } from "lucide-react";

export function PromoCode() {
  return (
    <div className="relative">
      <div className="relative">
        <Tag className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#5B403C]" />
        <input
          type="text"
          placeholder="Add promo code"
          className="h-[49px] w-full rounded-xl border border-[#E5E2E1] bg-white pl-12 pr-24 font-inter text-base text-[#5B403C] placeholder:text-[#5B403C] focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
        />
        <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-[#EAE7E7] px-4 py-1.5 font-inter text-sm font-semibold text-[#1C1B1B] hover:bg-[#ddd9d9]">
          Apply
        </button>
      </div>
    </div>
  );
}
