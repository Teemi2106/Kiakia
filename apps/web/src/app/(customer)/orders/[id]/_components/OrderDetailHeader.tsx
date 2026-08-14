// app/(customer)/orders/[id]/_components/OrderDetailHeader.tsx
"use client";

import { CheckCircle2, Clock, Package, Truck, AlertCircle } from "lucide-react";

interface OrderDetailHeaderProps {
  status: string;
  vendorName: string;
}

export function OrderDetailHeader({
  status,
  vendorName,
}: OrderDetailHeaderProps) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case "delivered":
        return {
          icon: CheckCircle2,
          title: "Order Delivered!",
          subtitle: `${vendorName} has delivered your order. Enjoy!`,
          bgColor: "bg-[rgba(23,106,34,0.1)]",
          iconColor: "bg-[#358439]",
          iconBg: "text-[#F7FFF1]",
        };
      case "in_transit":
        return {
          icon: Truck,
          title: "Order On The Way!",
          subtitle: `Your order from ${vendorName} is on its way to you.`,
          bgColor: "bg-[rgba(254,142,39,0.1)]",
          iconColor: "bg-[#FE8E27]",
          iconBg: "text-[#653200]",
        };
      case "preparing":
        return {
          icon: Clock,
          title: "Order Confirmed!",
          subtitle: `${vendorName} is preparing your order.`,
          bgColor: "bg-[rgba(23,106,34,0.1)]",
          iconColor: "bg-[#358439]",
          iconBg: "text-[#F7FFF1]",
        };
      case "ready_for_pickup":
        return {
          icon: Package,
          title: "Ready for Pickup!",
          subtitle: `Your order from ${vendorName} is ready for pickup.`,
          bgColor: "bg-[rgba(254,142,39,0.1)]",
          iconColor: "bg-[#FE8E27]",
          iconBg: "text-[#653200]",
        };
      default:
        return {
          icon: CheckCircle2,
          title: "Order Placed!",
          subtitle: `Your order from ${vendorName} has been placed.`,
          bgColor: "bg-[rgba(23,106,34,0.1)]",
          iconColor: "bg-[#358439]",
          iconBg: "text-[#F7FFF1]",
        };
    }
  };

  const config = getStatusConfig(status);
  const Icon = config.icon;

  return (
    <div
      className={`flex flex-col items-center justify-center gap-4 p-6 ${config.bgColor}`}
    >
      <div className={`rounded-full ${config.iconColor} p-4`}>
        <Icon className={`size-8 ${config.iconBg}`} />
      </div>
      <div className="text-center">
        <h1 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.32px] text-[#1C1B1B]">
          {config.title}
        </h1>
        <p className="font-inter text-base text-[#5B403C]">{config.subtitle}</p>
      </div>
    </div>
  );
}
