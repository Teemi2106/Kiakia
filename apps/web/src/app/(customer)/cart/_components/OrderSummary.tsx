// app/(auth)/customer/cart/_components/OrderSummary.tsx
import { formatNaira, koboOf } from "@kiakia/domain";

interface OrderSummaryProps {
  total: number;
}

export function OrderSummary({ total }: OrderSummaryProps) {
  return (
    <div className="rounded-xl border border-[#E5E2E1] bg-white p-4 shadow-sm">
      <div className="space-y-3">
        <div className="flex justify-between">
          <span className="font-inter text-base text-[#5B403C]">Subtotal</span>
          <span className="font-inter text-base font-semibold text-[#1C1B1B]">
            {formatNaira(koboOf(total))}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="font-inter text-base text-[#5B403C]">
            Delivery fee
          </span>
          {/* No delivery address is known yet at the cart stage, so there is
              nothing to compute a distance-based fee from - see checkout's
              own OrderSummary for where the real, address-aware estimate
              actually lives (useDeliveryFeeEstimate). Saying "₦0.00" here
              would read as a promise of free delivery this cart cannot
              back up. */}
          <span className="font-inter text-base font-semibold text-[#5B403C]">
            Calculated at checkout
          </span>
        </div>
        <div className="h-px bg-[#E5E2E1]" />
        <div className="flex justify-between pt-2">
          <span className="font-sora text-2xl font-bold text-[#1C1B1B]">
            Total
          </span>
          <span className="font-sora text-2xl font-bold text-[#B61913]">
            {formatNaira(koboOf(total))}
          </span>
        </div>
      </div>
    </div>
  );
}
