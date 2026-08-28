// app/(customer)/cart/_components/DeliveryInfo.tsx
import { Clock } from "lucide-react";

/**
 * The cart page has no selected delivery address yet (that's chosen at
 * checkout) and there's no delivery-time estimation system in this app, so
 * this intentionally doesn't fabricate a specific ETA or address — that was
 * the previous behavior ("30-40 minutes to 123 victoria island", hardcoded
 * regardless of vendor or customer). It just sets honest expectations about
 * when a real estimate shows up.
 */
export function DeliveryInfo() {
  return (
    <div className="flex items-start gap-4 rounded-xl bg-[#F6F3F2] p-4">
      <div className="rounded-full bg-[rgba(182,25,19,0.1)] p-2">
        <Clock className="size-5 text-[#B61913]" />
      </div>
      <div>
        <h3 className="font-inter text-sm font-semibold text-[#1C1B1B]">
          Delivery Time
        </h3>
        <p className="font-inter text-base text-[#5B403C]">
          You&apos;ll see an estimated delivery time after choosing your
          address at checkout.
        </p>
      </div>
    </div>
  );
}
