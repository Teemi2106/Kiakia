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
          <span className="font-inter text-base font-semibold text-[#1C1B1B]">
            {formatNaira(koboOf(0))}
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
