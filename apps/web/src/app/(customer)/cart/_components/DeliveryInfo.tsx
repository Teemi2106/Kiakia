// app/(auth)/customer/cart/_components/DeliveryInfo.tsx
import { Clock } from "lucide-react";

export function DeliveryInfo() {
  return (
    <div className="flex items-start gap-4 rounded-xl bg-[#F6F3F2] p-4">
      <div className="rounded-full bg-[rgba(182,25,19,0.1)] p-2">
        <Clock className="size-5 text-[#B61913]" />
      </div>
      <div>
        <h3 className="font-inter text-sm font-semibold text-[#1C1B1B]">
          Estimated Delivery Time
        </h3>
        <p className="font-inter text-base text-[#5B403C]">
          30-40 minutes to 123 victoria island
        </p>
      </div>
    </div>
  );
}
