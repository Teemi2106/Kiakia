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

/** Generic status badge for vendor/rider/user/payment/offer states; orders use OrderStatusBadge. */
export function StatusPill({ status }: { status: string }) {
  return <Badge tone={TONES[status] ?? "neutral"}>{humanize(status)}</Badge>;
}
