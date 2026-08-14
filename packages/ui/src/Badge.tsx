import type { OrderStatus } from "@kiakia/domain";
import { cva } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "positive" | "warning" | "danger";

const badgeVariants = cva(
  "inline-flex items-center rounded-pill px-15 py-2 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-surface-sunken text-ink-muted",
        positive: "bg-positive-surface text-positive",
        warning: "bg-warning-surface text-warning",
        danger: "bg-danger-surface text-danger",
      } satisfies Record<BadgeTone, string>,
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Pill-shaped status badge, per §20 ("pill category chips, amber/red/green status badges"). */
export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const ORDER_STATUS_PRESENTATION: Record<
  OrderStatus,
  { label: string; tone: BadgeTone }
> = {
  draft: { label: "Draft", tone: "neutral" },
  placed: { label: "Placed", tone: "warning" },
  accepted: { label: "Accepted", tone: "warning" },
  rejected_by_vendor: { label: "Rejected", tone: "danger" },
  preparing: { label: "Preparing", tone: "warning" },
  ready_for_pickup: { label: "Ready for pickup", tone: "warning" },
  rider_assigned: { label: "Rider assigned", tone: "warning" },
  picked_up: { label: "Picked up", tone: "warning" },
  in_transit: { label: "On the way", tone: "warning" },
  arrived: { label: "Arrived", tone: "warning" },
  delivered: { label: "Delivered", tone: "positive" },
  failed_delivery: { label: "Delivery failed", tone: "danger" },
  cancelled_by_customer: { label: "Cancelled", tone: "danger" },
  cancelled_by_platform: { label: "Cancelled", tone: "danger" },
};

/** Maps an order_state_machine OrderStatus to its display label + tone (§20, §10). */
export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const { label, tone } = ORDER_STATUS_PRESENTATION[status];
  return (
    <Badge tone={tone} className={className}>
      {label}
    </Badge>
  );
}
