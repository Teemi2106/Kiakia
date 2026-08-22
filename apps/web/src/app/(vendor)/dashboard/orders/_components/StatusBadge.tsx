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
        return { label: "New", color: "bg-[#B61913]/10 text-[#B61913]" };
      case "accepted":
        return { label: "Accepted", color: "bg-[#FE8E27]/10 text-[#FE8E27]" };
      case "preparing":
        return { label: "Preparing", color: "bg-[#FE8E27]/10 text-[#FE8E27]" };
      case "ready_for_pickup":
        return { label: "Ready", color: "bg-[#176A22]/10 text-[#176A22]" };
      case "rider_assigned":
        return {
          label: "Rider Assigned",
          color: "bg-[#176A22]/10 text-[#176A22]",
        };
      case "picked_up":
        return { label: "Picked Up", color: "bg-[#176A22]/10 text-[#176A22]" };
      case "in_transit":
        return { label: "In Transit", color: "bg-[#176A22]/10 text-[#176A22]" };
      case "arrived":
        return { label: "Arrived", color: "bg-[#176A22]/10 text-[#176A22]" };
      case "delivered":
        return { label: "Delivered", color: "bg-[#176A22]/10 text-[#176A22]" };
      default:
        return { label: status, color: "bg-[#E5E2E1] text-[#5B403C]" };
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
