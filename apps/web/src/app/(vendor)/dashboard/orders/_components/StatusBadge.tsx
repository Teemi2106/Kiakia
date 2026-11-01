// app/(vendor)/orders/_components/StatusBadge.tsx
"use client";

import { cn } from "@kiakia/ui";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case "placed":
        return { label: "New", color: "bg-kk-red/10 text-kk-red-ink" };
      case "accepted":
        return { label: "Accepted", color: "bg-kk-orange/10 text-kk-orange" };
      case "preparing":
        return { label: "Preparing", color: "bg-kk-orange/10 text-kk-orange" };
      case "ready_for_pickup":
        return { label: "Ready", color: "bg-kk-green/10 text-kk-green-ink" };
      case "rider_assigned":
        return {
          label: "Rider Assigned",
          color: "bg-kk-green/10 text-kk-green-ink",
        };
      case "picked_up":
        return { label: "Picked Up", color: "bg-kk-green/10 text-kk-green-ink" };
      case "in_transit":
        return { label: "In Transit", color: "bg-kk-green/10 text-kk-green-ink" };
      case "arrived":
        return { label: "Arrived", color: "bg-kk-green/10 text-kk-green-ink" };
      case "delivered":
        return { label: "Delivered", color: "bg-kk-green/10 text-kk-green-ink" };
      default:
        return { label: status, color: "bg-kk-hair text-kk-cocoa" };
    }
  };

  const config = getStatusConfig(status);

  return (
    <span
      className={cn(
        "rounded-full px-3 py-1 text-xs font-bold uppercase",
        config.color,
        className,
      )}
    >
      {config.label}
    </span>
  );
}
