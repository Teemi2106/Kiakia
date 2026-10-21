import { Badge, type BadgeTone } from "@kiakia/ui";
import { humanize } from "./format";

const TONES: Record<string, BadgeTone> = {
  active: "positive",
  approved: "positive",
  success: "positive",
  paid: "positive",
  completed: "positive",
  accepted: "positive",
  online: "positive",
  delivered: "positive",
  sent: "positive",
  queued: "warning",
  sending: "warning",
  pending: "warning",
  offered: "warning",
  held: "warning",
  suspended: "danger",
  rejected: "danger",
  failed: "danger",
  deleted: "danger",
  declined: "danger",
  revoked: "danger",
  expired: "neutral",
  refunded: "neutral",
};

/** Words that read better than the stored value. */
const LABELS: Record<string, string> = {
  success: "Successful",
  held: "Held until delivery",
  offered: "Offered to rider",
  revoked: "Taken back",
};

/**
 * Generic status badge for vendor/rider/user/payment/offer states; orders use OrderStatusBadge.
 * `label` overrides the wording where the same stored value means something different
 * on a page ("pending" is "Pending approval" for a store, "Awaiting payment" for an order).
 */
export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <Badge tone={TONES[status] ?? "neutral"}>{label ?? LABELS[status] ?? humanize(status)}</Badge>;
}
