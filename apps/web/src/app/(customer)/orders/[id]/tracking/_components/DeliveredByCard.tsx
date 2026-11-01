import { Store } from "lucide-react";

/**
 * Replaces the rider card when the store delivers the order itself. No rider
 * exists for such an order, so there is nothing to call or show on the map.
 */
export function DeliveredByCard({ storeName, compact = false }: { storeName: string; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border ${compact ? "border-kk-fill p-3" : "border-kk-line p-4"} bg-kk-card shadow-sm`}>
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-notice-surface">
        <Store className="size-5 text-kk-orange-ink" aria-hidden="true" />
      </div>
      <div>
        <p className="font-inter text-sm font-semibold text-kk-ink">Delivered by {storeName}</p>
        <p className="font-inter text-xs text-kk-cocoa">The store is bringing your order to you.</p>
      </div>
    </div>
  );
}
