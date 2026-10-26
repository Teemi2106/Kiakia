// supabase/functions/_shared/expo.ts
//
// Expo push helpers shared by dispatch-push (the legacy pg_net path, kept for
// rollback) and message-worker (the transactional-outbox path, migration 0103).
// Moved here from dispatch-push/expo.ts so there is ONE implementation of
// building a message, sending it and reading Expo's tickets.
//
// Web APIs only (fetch, Date) and no Deno globals, so it is unit-tested under
// Node (see expo.test.ts). No function here logs. Error strings returned by the
// outbox helpers are short codes (no token, body or response text): they are
// stored in message_outbox.error, which admins read.
//
// No `expo-server-sdk` dependency: the send is one POST with a JSON array
// (Expo's endpoint takes an array in one request).

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: "default";
  priority: "high";
  channelId: string;
  data: Record<string, unknown>;
  /** Seconds Expo keeps trying to deliver; omitted = Expo's default. */
  ttl?: number;
}

export function buildOfferPushMessages(params: {
  tokens: readonly string[];
  vendorName: string;
  orderId: string;
}): ExpoPushMessage[] {
  return params.tokens.map((to) => ({
    to,
    title: "New delivery",
    body: `Pickup from ${params.vendorName}. Tap to see it.`,
    sound: "default",
    priority: "high",
    // Matches the Android notification channel the app itself creates -
    // `ensureAndroidChannel()`, src/features/notifications/push.ts. A push
    // sent to an unknown channel id on Android arrives silently, without
    // the heads-up banner an offer needs.
    channelId: "offers",
    data: { type: "dispatch_offer", orderId: params.orderId },
  }));
}

/** A message built from a message_outbox push row (title = subject, data = the stored payload). */
export function buildOutboxPushMessages(params: {
  tokens: readonly string[];
  title: string;
  body: string;
  data: Record<string, unknown>;
  ttlSeconds?: number;
}): ExpoPushMessage[] {
  return params.tokens.map((to) => ({
    to,
    title: params.title,
    body: params.body,
    sound: "default",
    priority: "high",
    channelId: "offers",
    data: params.data,
    ...(params.ttlSeconds !== undefined ? { ttl: params.ttlSeconds } : {}),
  }));
}

/**
 * One "ticket" per message, in the same order the messages were sent.
 * `status: "error"` with `details.error === "DeviceNotRegistered"` is the
 * signal callers use to prune a dead token - Expo's own documented way of
 * reporting an uninstalled app or a revoked OS permission.
 */
export interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** The push API answered with a non-2xx status. The message is unchanged from the original dispatch-push helper. */
export class ExpoHttpError extends Error {
  readonly status: number;
  constructor(status: number, bodyText: string) {
    super(`Expo push API returned ${status}: ${bodyText}`);
    this.name = "ExpoHttpError";
    this.status = status;
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function sendExpoPushMessages(
  messages: readonly ExpoPushMessage[],
  fetchImpl: FetchLike = fetch,
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];

  const response = await fetchImpl(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    throw new ExpoHttpError(response.status, await response.text());
  }

  const payload = (await response.json()) as { data?: ExpoPushTicket[]; errors?: unknown[] };

  // Expo's top-level `errors` array means the REQUEST itself was malformed
  // (not an individual message) - every ticket would be missing, and
  // there is nothing per-message to report back.
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(`Expo push API rejected the request: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data ?? [];
}

/** Token strings from tickets reporting the token as permanently dead. */
export function deadTokensFrom(
  tokens: readonly string[],
  tickets: readonly ExpoPushTicket[],
): string[] {
  const dead: string[] = [];
  tickets.forEach((ticket, index) => {
    if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
      const token = tokens[index];
      if (token !== undefined) dead.push(token);
    }
  });
  return dead;
}

// ---------------------------------------------------------------------------
// The outbox path (message-worker)
// ---------------------------------------------------------------------------

/** The columns of a claimed message_outbox push row this module reads. */
export interface PushOutboxRow {
  id: string;
  subject: string | null;
  body: string;
  data?: Record<string, unknown> | null;
  expires_at?: string | null;
}

/**
 * What the worker should record.
 *  - sent:      at least one device accepted it.
 *  - no_tokens: nothing to send to (no tokens, or every token was dead):
 *               suppressed 'no_push_token' - not a failure, the offer row and
 *               the SMS fallback still reach the rider.
 *  - failed:    transient (permanent=false: retried with backoff up to
 *               max_send_attempts) or permanent. `error` is a short code.
 * `dead` = tokens to delete from rider_push_tokens in every case.
 */
export type PushOutcome =
  | { kind: "sent"; providerMessageId: string; dead: string[] }
  | { kind: "no_tokens"; dead: string[] }
  | { kind: "failed"; permanent: boolean; error: string; dead: string[] };

const PERMANENT_TICKET_ERRORS = new Set(["MessageTooBig", "InvalidCredentials"]);

/** Reads Expo's tickets (positionally matched to `tokens`) into one outcome. */
export function interpretExpoTickets(tokens: readonly string[], tickets: readonly ExpoPushTicket[]): PushOutcome {
  const dead = deadTokensFrom(tokens, tickets);
  const ok = tickets.find((t) => t.status === "ok");
  if (ok) return { kind: "sent", providerMessageId: ok.id ?? "expo", dead };
  if (tickets.length === 0) return { kind: "failed", permanent: false, error: "expo_no_tickets", dead };

  const live = tickets.filter((t) => !(t.status === "error" && t.details?.error === "DeviceNotRegistered"));
  if (live.length === 0) return { kind: "no_tokens", dead };

  const code = live.find((t) => t.details?.error)?.details?.error ?? "unknown";
  const safe = /^[A-Za-z]{1,40}$/.test(code) ? code : "unknown";
  return { kind: "failed", permanent: PERMANENT_TICKET_ERRORS.has(safe), error: `expo_ticket_${safe}`, dead };
}

/** Seconds until `expiresAt` (at least 1, at most one hour), or undefined if unset/invalid. */
export function ttlSecondsFor(expiresAt: string | null | undefined, now: Date = new Date()): number | undefined {
  if (!expiresAt) return undefined;
  const ms = Date.parse(expiresAt) - now.getTime();
  if (!Number.isFinite(ms)) return undefined;
  return Math.min(3600, Math.max(1, Math.floor(ms / 1000)));
}

/**
 * Sends one outbox push row to all of the recipient's tokens and classifies the
 * result. Never throws: a transport failure becomes a 'failed' outcome with a
 * short code (HTTP 5xx / 429 / 408 / network: transient; other 4xx: permanent).
 */
export async function sendOutboxPush(
  row: PushOutboxRow,
  tokens: readonly string[],
  fetchImpl: FetchLike = fetch,
  now: Date = new Date(),
): Promise<PushOutcome> {
  if (tokens.length === 0) return { kind: "no_tokens", dead: [] };

  const messages = buildOutboxPushMessages({
    tokens,
    title: row.subject?.trim() || "KiaKia",
    body: row.body,
    data: row.data ?? {},
    ttlSeconds: ttlSecondsFor(row.expires_at, now),
  });

  try {
    const tickets = await sendExpoPushMessages(messages, fetchImpl);
    return interpretExpoTickets(tokens, tickets);
  } catch (error) {
    if (error instanceof ExpoHttpError) {
      const transient = error.status >= 500 || error.status === 429 || error.status === 408;
      return { kind: "failed", permanent: !transient, error: `expo_http_${error.status}`, dead: [] };
    }
    return { kind: "failed", permanent: false, error: "expo_error", dead: [] };
  }
}
