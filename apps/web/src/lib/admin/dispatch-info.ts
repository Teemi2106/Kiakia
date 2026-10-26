import { z } from "zod";
import { formatLagosTime } from "../time";
import { formatKm } from "./dispatch-settings-info";

/**
 * Plain-language reading of admin_dispatch_status() (0097/0098/0102): orders
 * that are ready (or about to be) with no rider, plus the ones whose search
 * starts later. Pure so the Waiting for a rider page, the Overview tile, the
 * order page notice and the tests all say the same thing.
 */

export const WAITING_REASONS = [
  "scheduled",
  "waiting_for_rider_reply",
  "no_online_riders",
  "none_in_range",
  "fee_exceeds_order_budget",
  "all_declined_or_expired",
  "needs_attention",
] as const;
export type WaitingReason = (typeof WAITING_REASONS)[number];

export interface LiveOffer {
  readonly riderName: string | null;
  /** Which ask this is for the order (1 = the first rider asked). */
  readonly attemptNo: number;
  /** Seconds left to answer, as of when the page was read. */
  readonly secondsLeft: number;
  /** How long this rider would take to reach the store, when known. */
  readonly etaSeconds: number | null;
}

export interface WaitingOrder {
  readonly orderId: string;
  readonly orderCode: string;
  readonly vendorId: string | null;
  readonly vendorName: string | null;
  readonly waitingSeconds: number;
  /** Riders online across KiaKia (not just for this order). */
  readonly ridersOnline: number;
  /** Online riders who could take this order (approved, fresh location, free). */
  readonly eligibleRiders: number;
  /** Riders within the first-round distance (all eligible riders when there is no limit). */
  readonly ridersWithinRadius: number;
  /** Riders within this store's own delivery distance (where the search widens to). */
  readonly ridersWithinStoreRadius: number;
  /** Riders in range for whom the order's budget can cover the rider's pay. */
  readonly fundableRidersInRange: number;
  /** Distance from the store to the nearest online rider, null when nobody is online. */
  readonly nearestRiderM: number | null;
  /** Riders asked so far for this order, across all rounds. */
  readonly attemptsMade: number;
  /** Which round the search is in (0 = not started). */
  readonly roundNo: number;
  readonly liveOffer: LiveOffer | null;
  /** When the system expects the food to be ready, and when it plans to start the search. */
  readonly expectedReadyAt: string | null;
  readonly startAt: string | null;
  /** True when someone should step in; attentionReason says why in the database's words. */
  readonly needsAttention: boolean;
  readonly attentionReason: string | null;
  /** The first-round distance. 0 = no limit. */
  readonly radiusM: number;
  /** How far this store delivers (vendors.delivery_radius_m): the search widens to this. */
  readonly storeRadiusM: number;
  /** True once the search has widened to the store's own distance. */
  readonly widened: boolean;
  readonly lastAttempt: { readonly at: string; readonly radiusM: number | null; readonly ridersInRange: number; readonly offersCreated: number } | null;
  readonly reason: WaitingReason;
}

/** An accepted order whose rider search has not started yet. */
export interface UpcomingOrder {
  readonly orderId: string;
  readonly orderCode: string;
  readonly vendorName: string | null;
  readonly expectedReadyAt: string | null;
  readonly startAt: string | null;
  readonly startsInSeconds: number;
}

export interface DispatchStatus {
  readonly orders: readonly WaitingOrder[];
  readonly upcoming: readonly UpcomingOrder[];
  readonly needsAttentionCount: number;
  readonly onlineRiders: number;
}

const count = z.number().nullish();
const text = z.string().nullish();

const statusOrderSchema = z.object({
  order_id: z.string(),
  code: text,
  vendor_id: text,
  vendor_name: text,
  status: text,
  waiting_since: text,
  delivery_by: text,
  offers_made: count,
  nearest_online_rider_m: count,
  riders_within_radius: count,
  riders_within_store_radius: count,
  store_radius_m: count,
  last_attempt: z.object({ at: text, radius_m: count, riders_in_range: count, offers_created: count }).nullish(),
  reason: text,
  widened: z.boolean().nullish(),
  eligible_riders: count,
  fundable_riders_in_range: count,
  dispatch_state: text,
  live_offer: z.object({ rider_name: text, attempt_no: count, seconds_left: count, eta_seconds: count }).nullish(),
  cycle_no: count,
  attempts_made: count,
  start_at: text,
  expected_ready_at: text,
  needs_attention: z.boolean().nullish(),
  attention_reason: text,
});

const upcomingSchema = z.object({
  order_id: z.string(),
  code: text,
  vendor_name: text,
  expected_ready_at: text,
  start_at: text,
  starts_in_seconds: count,
});

const statusPayloadSchema = z.object({
  settings: z.object({ radius_m: count }).nullish(),
  online_riders: count,
  needs_attention_count: count,
  stuck_orders: z.array(statusOrderSchema).nullish(),
  upcoming: z.array(upcomingSchema).nullish(),
});

/** Raw shape of admin_dispatch_status() (jsonb, 0102). */
export type DispatchStatusPayload = z.input<typeof statusPayloadSchema>;
export type DispatchStatusOrder = z.input<typeof statusOrderSchema>;

/** Checks the RPC's jsonb against the shape above; a malformed document is an error, not an empty page. */
export function parseStatusPayload(data: unknown): DispatchStatusPayload {
  const parsed = statusPayloadSchema.safeParse(data ?? {});
  if (!parsed.success) throw new Error("admin_dispatch_status returned an unexpected shape");
  return parsed.data;
}

const num = (value: number | null | undefined): number => (value == null || !Number.isFinite(value) ? 0 : value);
const numOrNull = (value: number | null | undefined): number | null => (value == null || !Number.isFinite(value) ? null : value);

export function mapStatusOrder(row: DispatchStatusOrder, payload: DispatchStatusPayload, nowMs: number): WaitingOrder {
  const since = row.waiting_since ? Date.parse(row.waiting_since) : NaN;
  const attempt = row.last_attempt;
  const live = row.live_offer;
  return {
    orderId: row.order_id,
    orderCode: row.code ?? row.order_id,
    vendorId: row.vendor_id ?? null,
    vendorName: row.vendor_name ?? null,
    waitingSeconds: Number.isFinite(since) ? Math.max(0, Math.floor((nowMs - since) / 1000)) : 0,
    ridersOnline: num(payload.online_riders),
    eligibleRiders: num(row.eligible_riders),
    ridersWithinRadius: num(row.riders_within_radius),
    ridersWithinStoreRadius: num(row.riders_within_store_radius),
    fundableRidersInRange: num(row.fundable_riders_in_range),
    nearestRiderM: numOrNull(row.nearest_online_rider_m),
    attemptsMade: num(row.attempts_made ?? row.offers_made),
    roundNo: num(row.cycle_no),
    liveOffer: live
      ? { riderName: live.rider_name ?? null, attemptNo: num(live.attempt_no), secondsLeft: num(live.seconds_left), etaSeconds: numOrNull(live.eta_seconds) }
      : null,
    expectedReadyAt: row.expected_ready_at ?? null,
    startAt: row.start_at ?? null,
    needsAttention: row.needs_attention === true,
    attentionReason: row.attention_reason ?? null,
    radiusM: num(payload.settings?.radius_m),
    storeRadiusM: num(row.store_radius_m),
    widened: row.widened === true,
    lastAttempt:
      attempt?.at
        ? { at: attempt.at, radiusM: numOrNull(attempt.radius_m), ridersInRange: num(attempt.riders_in_range), offersCreated: num(attempt.offers_created) }
        : null,
    // The database falls back to needs_attention, so an unknown word is read the same way.
    reason: WAITING_REASONS.find((candidate) => candidate === row.reason) ?? "needs_attention",
  };
}

export function mapStatusPayload(payload: DispatchStatusPayload | null, nowMs = Date.now()): WaitingOrder[] {
  const rows = (payload?.stuck_orders ?? []).filter((row) => row.delivery_by !== "vendor");
  return rows.map((row) => mapStatusOrder(row, payload ?? {}, nowMs));
}

export function readDispatchStatus(data: unknown, nowMs = Date.now()): DispatchStatus {
  const payload = parseStatusPayload(data);
  return {
    orders: mapStatusPayload(payload, nowMs),
    upcoming: (payload.upcoming ?? []).map((row) => ({
      orderId: row.order_id,
      orderCode: row.code ?? row.order_id,
      vendorName: row.vendor_name ?? null,
      expectedReadyAt: row.expected_ready_at ?? null,
      startAt: row.start_at ?? null,
      startsInSeconds: num(row.starts_in_seconds),
    })),
    needsAttentionCount: num(payload.needs_attention_count),
    onlineRiders: num(payload.online_riders),
  };
}

/** A rider can still answer, or the search has not started: nothing for an admin to do yet. */
function isQuiet(order: WaitingOrder): boolean {
  return !order.needsAttention && (order.reason === "scheduled" || order.reason === "waiting_for_rider_reply");
}

/** Orders that need an admin's attention: everything except those being searched on schedule. */
export function needsAttention(orders: readonly WaitingOrder[]): WaitingOrder[] {
  return orders.filter((order) => !isQuiet(order));
}

/** The rest: a rider is being asked, or the search starts later. */
export function beingHandled(orders: readonly WaitingOrder[]): WaitingOrder[] {
  return orders.filter(isQuiet);
}

/** "under a minute", "23 min", "1 hr 5 min", "2 hr". */
export function formatWaiting(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** "about 7 min" for a rider's travel time; "under a minute" below 30 s. */
export function formatTravel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes < 1 ? "under a minute" : `about ${minutes} min`;
}

/** The database's reason an order was flagged, in words an operator can act on. */
export function describeAttentionReason(reason: string | null): string {
  switch (reason) {
    case "two_cycles_without_accept":
      return "No rider accepted after two full rounds";
    case "worker_errors":
      return "The system hit errors while searching";
    default:
      return "No rider nearby for a while";
  }
}

export interface WaitingExplanation {
  readonly headline: string;
  /** What the admin can do about it, in words. */
  readonly action: string;
  /** True when the suggested action involves the Settings page, so the UI can link it. */
  readonly mentionsSettings: boolean;
}

/** The distance this order is searching right now, in words ("5 km", or "any distance"). */
function searchDistance(order: WaitingOrder): string {
  const metres = order.widened && order.storeRadiusM > 0 ? order.storeRadiusM : order.radiusM;
  return metres > 0 ? formatKm(metres) : "any distance";
}

/** "Looked within 5 km; this store delivers up to 20 km", or "No distance limit is set; this store delivers up to 20 km". */
export function describeDistances(order: WaitingOrder): string {
  const looked = order.radiusM > 0 ? `Looked within ${formatKm(order.radiusM)}` : "No distance limit is set, so every online rider was considered";
  const store = order.storeRadiusM > 0 ? `this store delivers up to ${formatKm(order.storeRadiusM)}` : null;
  return store ? `${looked}; ${store}` : looked;
}

function noneInRange(order: WaitingOrder): WaitingExplanation {
  const nearest = order.nearestRiderM;
  const within = `none within ${searchDistance(order)}`;
  const headline = nearest === null ? `Riders are online but ${within}.` : `Riders are online but ${within}: the nearest is ${formatKm(nearest)} away.`;
  if (order.widened || order.radiusM === 0) {
    return {
      headline,
      action: "The search already covers everything this store delivers to. Ask a rider to move closer, or assign a rider yourself from the order page.",
      mentionsSettings: false,
    };
  }
  const needed = nearest === null ? "" : ` (to at least ${formatKm(Math.ceil(nearest / 1000) * 1000)})`;
  return {
    headline,
    action: `After the wait set in Settings, the search widens by itself to the store's own distance (${formatKm(order.storeRadiusM)}). You can also raise the first distance${needed} in Settings, or ask a rider to move closer.`,
    mentionsSettings: true,
  };
}

function scheduled(order: WaitingOrder): WaitingExplanation {
  const start = formatLagosTime(order.startAt);
  const ready = formatLagosTime(order.expectedReadyAt);
  return {
    headline: start ? `Search starts at ${start}.` : "The search for a rider has not started yet.",
    action: `The system starts looking shortly before the food is ready, so the rider arrives about when it is${ready ? ` (food expected ready at ${ready})` : ""}. Nothing to do.`,
    mentionsSettings: false,
  };
}

function waitingForReply(order: WaitingOrder): WaitingExplanation {
  const offer = order.liveOffer;
  const who = offer?.riderName ?? "a rider";
  return {
    headline: offer ? `Waiting for ${who} to answer, ${offer.secondsLeft}s left.` : "Waiting for a rider to answer.",
    action: "If they decline or run out of time, the next rider is asked straight away. Nothing to do yet.",
    mentionsSettings: false,
  };
}

export function describeWaiting(order: WaitingOrder): WaitingExplanation {
  switch (order.reason) {
    case "needs_attention":
      return {
        headline: `${describeAttentionReason(order.attentionReason)}.`,
        action: "Send it to riders again, or assign a rider yourself from the order page.",
        mentionsSettings: false,
      };
    case "scheduled":
      return scheduled(order);
    case "waiting_for_rider_reply":
      return waitingForReply(order);
    case "no_online_riders":
      return {
        headline: order.ridersOnline === 0 ? "No riders are online." : `No rider can take this order right now (${order.ridersOnline} online, but busy or their location is out of date).`,
        action: "Ask riders to go online, or assign a rider yourself from the order page.",
        mentionsSettings: false,
      };
    case "none_in_range":
      return noneInRange(order);
    case "fee_exceeds_order_budget": {
      const inRange = order.widened ? order.ridersWithinStoreRadius : order.ridersWithinRadius;
      const who = inRange === 1 ? "A rider is nearby" : `${inRange} riders are nearby`;
      return {
        headline: `${who}, but paying them for this distance would cost more than this order brings in.`,
        action:
          "The order is too small to cover what a rider would earn for this trip, so nobody is asked. Assign a rider yourself from the order page, or ask the technical team to look at the delivery fee for this area.",
        mentionsSettings: false,
      };
    }
    case "all_declined_or_expired":
      return {
        headline: "All offered riders declined or ran out of time.",
        action: "A new round starts by itself. You can also send it to riders again, or assign a rider yourself from the order page.",
        mentionsSettings: false,
      };
  }
}

/** "Tried at 16:38: 0 riders within 5 km", or null when nothing was tried yet. */
export function describeLastAttempt(order: WaitingOrder): string | null {
  const attempt = order.lastAttempt;
  if (!attempt) return null;
  const riders = attempt.ridersInRange === 1 ? "1 rider" : `${attempt.ridersInRange} riders`;
  const where = attempt.radiusM && attempt.radiusM > 0 ? `within ${formatKm(attempt.radiusM)}` : "at any distance";
  return `Tried at ${formatLagosTime(attempt.at) ?? "an unknown time"}: ${riders} ${where}`;
}

/** What the Send to riders again button reports back. */
export function redispatchMessage(result: { offered: number; ridersInRange: number | null; liveOffer?: boolean; outcome?: string | null }): string {
  if (result.liveOffer) return "A rider is already being asked. Give them a moment to answer; if they decline, the next rider is asked straight away.";
  if (result.outcome === "not_dispatchable") return "This order can't be sent to riders right now (it may have a rider already, or it is not ready to be searched for).";
  if (result.offered > 0) return result.offered === 1 ? "Asking 1 rider now." : `Asking ${result.offered} riders now.`;
  if (result.ridersInRange !== null && result.ridersInRange > 0) {
    return "Nobody was asked: riders are in range but none can take the order right now (they may be busy, or the order is too small to pay them).";
  }
  return "No riders in range. Nobody was asked.";
}

const redispatchResultSchema = z.object({
  offers_created: count,
  riders_in_range: count,
  outcome: text,
  live_offer: z.boolean().nullish(),
});

/** Reads the result of admin_redispatch_order: {offers_created, riders_in_range, radius_m, tier, outcome, offer_id, live_offer}. */
export function parseRedispatchResult(data: unknown): { offered: number; ridersInRange: number | null; liveOffer: boolean; outcome: string | null } {
  const parsed = redispatchResultSchema.safeParse(data);
  const record = parsed.success ? parsed.data : {};
  return {
    offered: num(record.offers_created),
    ridersInRange: numOrNull(record.riders_in_range),
    liveOffer: record.live_offer === true,
    outcome: record.outcome ?? null,
  };
}
