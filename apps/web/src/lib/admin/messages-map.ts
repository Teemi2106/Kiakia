import { failureReasonLabel } from "@/lib/messaging/audience";

/**
 * Pure mapping of the messaging RPC results into the shapes the pages use.
 * Kept apart from the loaders so it tests without a database. Reads defensively:
 * a missing field becomes an empty value, never a crash on an admin page.
 */

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}
function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export interface AudiencePreview {
  readonly recipientCount: number;
  readonly suppressedCount: number;
  readonly noAddress: number;
  readonly noConsent: number;
  readonly suspended: number;
  readonly sample: readonly { readonly userId: string; readonly displayName: string; readonly role: string | null }[];
}

export function audiencePreviewFrom(raw: unknown): AudiencePreview {
  const r = obj(raw);
  const reasons = obj(r.suppressed_reasons);
  return {
    recipientCount: num(r.recipient_count),
    suppressedCount: num(r.suppressed_count),
    noAddress: num(reasons.no_address),
    noConsent: num(reasons.no_consent),
    suspended: num(reasons.suspended),
    sample: (Array.isArray(r.sample) ? r.sample : []).slice(0, 5).map((entry) => {
      const e = obj(entry);
      return { userId: str(e.user_id) ?? "", displayName: str(e.display_name) ?? "Unnamed", role: str(e.role) };
    }),
  };
}

export interface BroadcastCounts {
  readonly recipients: number;
  /** Queued or being sent right now. */
  readonly waiting: number;
  readonly sent: number;
  readonly delivered: number;
  readonly failed: number;
  readonly skipped: number;
}

/** Accepts the list row (flat) or the detail's `counts` object. */
export function countsFrom(raw: unknown): BroadcastCounts {
  const c = obj(raw);
  return {
    recipients: num(c.recipient_count ?? c.recipients ?? c.total),
    waiting: num(c.queued) + num(c.sending),
    sent: num(c.sent),
    delivered: num(c.delivered),
    failed: num(c.failed),
    skipped: num(c.suppressed ?? c.skipped),
  };
}

export interface BroadcastListItem {
  readonly id: string;
  readonly createdAt: string;
  readonly createdByName: string | null;
  readonly channel: "email" | "sms";
  readonly category: "transactional" | "promotional";
  readonly audienceLabel: string;
  readonly subject: string | null;
  readonly body: string;
  readonly counts: BroadcastCounts;
}

function itemFrom(r: Json, counts: BroadcastCounts): BroadcastListItem {
  return {
    id: str(r.id) ?? "",
    createdAt: str(r.created_at) ?? "",
    createdByName: str(r.created_by_name),
    channel: r.channel === "sms" ? "sms" : "email",
    category: r.category === "promotional" ? "promotional" : "transactional",
    audienceLabel: str(r.audience_label) ?? "",
    subject: str(r.subject),
    body: str(r.body) ?? "",
    counts,
  };
}

export function broadcastRowFrom(raw: unknown): { item: BroadcastListItem; total: number } {
  const r = obj(raw);
  return { total: num(r.total_count), item: itemFrom(r, countsFrom(r)) };
}

export interface BroadcastDetail extends BroadcastListItem {
  /** At most 20, with the provider's raw text already turned into plain words. */
  readonly failures: readonly { readonly displayName: string; readonly reason: string }[];
}

export function broadcastDetailFrom(raw: unknown): BroadcastDetail {
  const r = obj(raw);
  // The broadcast's own fields may sit at the top level or under `broadcast`.
  const fields = { ...obj(r.broadcast), ...r };
  const counts = obj(r.counts);
  return {
    ...itemFrom(fields, countsFrom({ recipient_count: fields.recipient_count, ...counts })),
    failures: (Array.isArray(r.failures) ? r.failures : []).slice(0, 20).map((entry) => {
      const e = obj(entry);
      return { displayName: str(e.display_name) ?? "Unnamed", reason: failureReasonLabel(str(e.error)) };
    }),
  };
}

export interface UserMessage {
  readonly id: string;
  readonly createdAt: string;
  readonly channel: "email" | "sms";
  readonly category: "transactional" | "promotional";
  readonly subject: string | null;
  readonly body: string;
  readonly status: string;
  /** Plain words, or null when nothing went wrong. */
  readonly problem: string | null;
}

const SKIP_REASONS: Record<string, string> = {
  no_address: "Skipped: no email or phone number on file",
  no_consent: "Skipped: has not agreed to promotions",
  opted_out: "Skipped: has opted out of promotions",
  suspended: "Skipped: account suspended",
  expired: "Skipped: it was too late to send",
  rate_limited: "Skipped: too many messages to this person",
};

export function userMessageRowFrom(raw: unknown): UserMessage {
  const r = obj(raw);
  const status = str(r.status) ?? "queued";
  const skipped = SKIP_REASONS[str(r.suppress_reason) ?? ""];
  return {
    id: str(r.id) ?? "",
    createdAt: str(r.created_at) ?? "",
    channel: r.channel === "sms" ? "sms" : "email",
    category: r.category === "promotional" ? "promotional" : "transactional",
    subject: str(r.subject),
    body: str(r.body) ?? "",
    status,
    problem: status === "failed" ? failureReasonLabel(str(r.error)) : status === "suppressed" ? (skipped ?? "Skipped") : null,
  };
}
