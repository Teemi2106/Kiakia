/** Who a message goes to, in the shape admin_audience_preview / admin_create_broadcast take. */

export type AudienceRole = "customer" | "vendor" | "rider";

export const SEGMENTS_BY_ROLE = {
  customer: ["all", "ordered_30d", "inactive_30d"],
  vendor: ["all", "active", "pending", "suspended"],
  rider: ["all", "active", "pending", "online"],
} as const satisfies Record<AudienceRole, readonly string[]>;

export type Audience =
  | { readonly kind: "role"; readonly role: AudienceRole; readonly segment: string }
  | { readonly kind: "user"; readonly user_id: string };

export const ROLE_LABELS: Record<AudienceRole, string> = {
  customer: "Customers",
  vendor: "Vendors",
  rider: "Riders",
};

export const SEGMENT_LABELS: Record<AudienceRole, Record<string, string>> = {
  customer: { all: "Everyone", ordered_30d: "Ordered in the last 30 days", inactive_30d: "Have not ordered in the last 30 days" },
  vendor: { all: "All vendors", active: "Active vendors", pending: "Waiting for approval", suspended: "Suspended vendors" },
  rider: { all: "All riders", active: "Approved riders", pending: "Waiting for approval", online: "Online now" },
};

export function isValidSegment(role: AudienceRole, segment: string): boolean {
  return (SEGMENTS_BY_ROLE[role] as readonly string[]).includes(segment);
}

export function audienceLabel(audience: Audience, personName?: string): string {
  if (audience.kind === "user") return personName ?? "One person";
  return `${ROLE_LABELS[audience.role]}: ${SEGMENT_LABELS[audience.role][audience.segment] ?? audience.segment}`;
}

export const CHANNEL_LABELS = { email: "Email", sms: "Text message" } as const;
export const CATEGORY_LABELS = { transactional: "Service message", promotional: "Promotion" } as const;
export type Channel = keyof typeof CHANNEL_LABELS;
export type Category = keyof typeof CATEGORY_LABELS;

/**
 * Plain-words reason a delivery failed, from the worker's and provider's error
 * codes (invalid_phone, resend_http_422:..., termii_network_error, bounced,
 * spam_complaint, ...). The raw text is never shown: it can contain addresses or
 * numbers, and means nothing to an owner.
 */
export function failureReasonLabel(raw: string | null | undefined): string {
  const text = (raw ?? "").toLowerCase();
  if (/spam|complain/.test(text)) return "Marked as spam by the person";
  if (/bounce|mailbox|no such user|rejected recipient|fake_permanent/.test(text)) return "Email bounced";
  if (/invalid_phone|invalid.*(phone|number|destination)|landline|unallocated|unknown subscriber/.test(text)) return "Phone number invalid";
  if (/provider_not_configured|network_error|_http_(401|403|408|409|429|5\d\d)|unavailable|timeout|timed out|worker_exception|transient|retry/.test(text)) {
    return "Provider unavailable: will retry";
  }
  if (/_http_4\d\d/.test(text)) return "The provider turned this message down";
  return "Could not be delivered";
}

/** Plain words for a message's delivery state. */
export function messageStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "Waiting to send";
    case "sending":
      return "Sending";
    case "sent":
      return "Sent";
    case "delivered":
      return "Delivered";
    case "failed":
      return "Failed";
    case "suppressed":
    case "skipped":
      return "Skipped";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
  }
}
