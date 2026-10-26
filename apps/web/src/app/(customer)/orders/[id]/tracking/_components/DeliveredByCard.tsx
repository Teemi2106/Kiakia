import { Store } from "lucide-react";

/**
 * Replaces the rider card when the store delivers the order itself. No rider
 * exists for such an order, so there is nothing to call or show on the map.
 */
export function DeliveredByCard({ storeName, compact = false }: { storeName: string; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border ${compact ? "border-[#F0EDED] p-3" : "border-[#E4BEB8] p-4"} bg-white shadow-sm`}>
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#FFDCC5]">
        <Store className="size-5 text-[#934B00]" aria-hidden="true" />
      </div>
      <div>
        <p className="font-inter text-sm font-semibold text-[#1C1B1B]">Delivered by {storeName}</p>
        <p className="font-inter text-xs text-[#5B403C]">The store is bringing your order to you.</p>
      </div>
    </div>
  );
}
