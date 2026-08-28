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
      case "arrived":
        return {
          icon: Truck,
          title: status === "arrived" ? "Rider Has Arrived!" : "Order On The Way!",
          subtitle: `Your order from ${vendorName} is on its way to you.`,
          bgColor: "bg-[rgba(254,142,39,0.1)]",
          iconColor: "bg-[#FE8E27]",
          iconBg: "text-[#653200]",
        };
      case "rider_assigned":
      case "picked_up":
        return {
          icon: Truck,
          title: "Rider On The Way to Vendor!",
          subtitle: `A rider is heading to ${vendorName} to pick up your order.`,
          bgColor: "bg-[rgba(254,142,39,0.1)]",
          iconColor: "bg-[#FE8E27]",
          iconBg: "text-[#653200]",
        };
      case "preparing":
        return {
          icon: Clock,
          title: "Order Confirmed!",
          subtitle: `${vendorName} is preparing your order.`,
          bgColor: "bg-[rgba(254,142,39,0.1)]",
          iconColor: "bg-[#FE8E27]",
          iconBg: "text-[#653200]",
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
      case "rejected_by_vendor":
        return {
          icon: AlertCircle,
          title: "Order Rejected",
          subtitle: `${vendorName} was unable to accept this order.`,
          bgColor: "bg-[rgba(186,26,26,0.1)]",
          iconColor: "bg-[#BA1A1A]",
          iconBg: "text-[#FFF5F5]",
        };
      case "failed_delivery":
        return {
          icon: AlertCircle,
          title: "Delivery Failed",
          subtitle: "We couldn't complete delivery for this order.",
          bgColor: "bg-[rgba(186,26,26,0.1)]",
          iconColor: "bg-[#BA1A1A]",
          iconBg: "text-[#FFF5F5]",
        };
      case "cancelled_by_customer":
      case "cancelled_by_platform":
        return {
          icon: AlertCircle,
          title: "Order Cancelled",
          subtitle: "This order was cancelled.",
          bgColor: "bg-[rgba(186,26,26,0.1)]",
          iconColor: "bg-[#BA1A1A]",
          iconBg: "text-[#FFF5F5]",
        };
      case "accepted":
        return {
          icon: CheckCircle2,
          title: "Order Confirmed!",
          subtitle: `${vendorName} accepted your order.`,
          bgColor: "bg-[rgba(23,106,34,0.1)]",
          iconColor: "bg-[#358439]",
          iconBg: "text-[#F7FFF1]",
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
