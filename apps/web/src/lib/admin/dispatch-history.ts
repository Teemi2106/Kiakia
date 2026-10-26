import { z } from "zod";
import { formatLagosTime } from "../time";
import { describeAttentionReason, formatTravel, formatWaiting } from "./dispatch-info";
import { formatKm } from "./dispatch-settings-info";

/**
 * Plain-language reading of admin_dispatch_order_history() (0102): every rider
 * asked for an order, how each answered, and the key things the system did.
 * Pure, so the history view and the tests say the same thing.
 */

const text = z.string().nullish();
const count = z.number().nullish();

const offerSchema = z.object({
  offer_id: z.string(),
  rider_id: text,
  rider_name: text,
  cycle_no: count,
  attempt_no: count,
  distance_m: count,
  eta_seconds: count,
  status: z.string(),
  close_reason: text,
  offered_at: text,
  responded_at: text,
  seconds_to_respond: count,
});

const eventSchema = z.object({
  at: z.string(),
  event: z.string(),
  rider_id: text,
  data: z.record(z.unknown()).nullish(),
});

const historySchema = z.object({
  order: z.object({ code: text, status: text, delivery_by: text }).nullish(),
  dispatch: z
    .object({
      state: text,
      cycle_no: count,
      start_at: text,
      expected_ready_at: text,
      assigned_at: text,
      assigned_eta_at: text,
      current_eta_at: text,
      rider_arrived_vendor_at: text,
      attention_reason: text,
    })
    .nullish(),
  offers: z.array(offerSchema).nullish(),
  events: z.array(eventSchema).nullish(),
});

export interface HistoryOffer {
  readonly offerId: string;
  readonly riderName: string;
  readonly roundNo: number;
  readonly attemptNo: number;
  readonly distanceM: number | null;
  readonly etaSeconds: number | null;
  readonly status: string;
  /** The outcome in plain words. */
  readonly outcome: string;
  readonly offeredAt: string | null;
  readonly secondsToRespond: number | null;
}

export interface HistoryEvent {
  readonly at: string;
  readonly text: string;
}

export interface DispatchHistory {
  readonly orderCode: string | null;
  readonly orderStatus: string | null;
  readonly deliveredByStore: boolean;
  /** Where the search stands, in words; null when the order has no dispatch record. */
  readonly stateText: string | null;
  readonly roundNo: number;
  readonly expectedReadyAt: string | null;
  readonly startAt: string | null;
  readonly assignedAt: string | null;
  /** When the assigned rider was first expected at the store, and the latest estimate. */
  readonly assignedEtaAt: string | null;
  readonly currentEtaAt: string | null;
  readonly riderArrivedAt: string | null;
  readonly offers: readonly HistoryOffer[];
  readonly events: readonly HistoryEvent[];
}

const num = (value: number | null | undefined): number | null => (value == null || !Number.isFinite(value) ? null : value);

/** How an offer ended (or is going), in words. */
export function describeOfferOutcome(status: string, closeReason: string | null): string {
  switch (status) {
    case "offered":
      return "Waiting for an answer";
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "expired":
      return "No answer in time";
    case "revoked":
      return "Taken off the order by an admin";
    case "superseded":
      if (closeReason === "order_assigned") return "Not needed: another rider took the order";
      if (closeReason === "admin_assigned" || closeReason === "admin_assign") return "Replaced when an admin assigned a rider";
      return "Replaced by a newer offer";
    case "cancelled":
      if (closeReason === "rider_unavailable") return "Cancelled: the rider went offline or became busy";
      if (closeReason === "vendor_self_delivery") return "Cancelled: the store chose to deliver it";
      return "Cancelled";
    default:
      return status;
  }
}

function describeState(state: string | null | undefined, attentionReason: string | null | undefined): string | null {
  switch (state) {
    case "scheduled":
      return "Search not started yet";
    case "searching":
      return "Searching for a rider";
    case "offered":
      return "Waiting for a rider to answer";
    case "assigned":
      return "A rider has the order";
    case "needs_attention":
      return `Needs attention: ${describeAttentionReason(attentionReason ?? null).toLowerCase()}`;
    case "stopped":
      return "Search stopped";
    default:
      return null;
  }
}

function str(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" ? value : null;
}

function numeric(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function atTime(iso: string | null): string {
  return formatLagosTime(iso) ?? "an unknown time";
}

/** One engine event as a sentence, or null for events that are only noise (the tick-delay log). */
export function describeDispatchEvent(event: string, rider: string, data: Record<string, unknown>): string | null {
  switch (event) {
    case "scheduled":
      return `The search was planned to start at ${atTime(str(data, "start_at"))} (food expected ready at ${atTime(str(data, "expected_ready_at"))}).`;
    case "start_recomputed":
      return str(data, "reason") === "admin_redispatch" ? "An admin pulled the search forward to now." : `The planned search start moved to ${atTime(str(data, "new"))}.`;
    case "cycle_started":
      return "A new round of asking riders started.";
    case "ring_expanded":
      return "The search widened to cover more nearby blocks.";
    case "offer_created": {
      const distance = numeric(data, "distance_m");
      const eta = numeric(data, "eta_seconds");
      const detail = [distance === null ? null : `${formatKm(distance)} away`, eta === null ? null : `would reach the store in ${formatTravel(eta)}`].filter(Boolean).join(", ");
      return `${rider} was asked${detail ? ` (${detail})` : ""}.`;
    }
    case "offer_accepted":
      return str(data, "path") === "admin_assign" ? `An admin assigned ${rider}.` : `${rider} accepted the order.`;
    case "offer_declined":
      return `${rider} declined.`;
    case "offer_expired":
      return `${rider} did not answer in time.`;
    case "offer_cancelled":
      return `The offer to ${rider} was cancelled.`;
    case "offer_superseded":
      return `The offer to ${rider} was replaced.`;
    case "accept_conflict":
      return `${rider} tried to accept, but the order was already taken.`;
    case "stale_accept_rejected":
      return `${rider} tried to accept, but the offer was no longer open.`;
    case "no_candidates":
      return "No rider could be asked just then.";
    case "needs_attention":
      return `Flagged for attention: ${describeAttentionReason(str(data, "reason")).toLowerCase()}.`;
    case "tick_error":
      return "The system hit an error while searching and will try again.";
    case "prep_estimate_changed":
      return `The store changed when the food will be ready to ${atTime(str(data, "new"))}.`;
    case "ready_early": {
      const early = numeric(data, "early_seconds");
      return early === null ? "The food was ready early." : `The food was ready ${formatWaiting(early)} early.`;
    }
    case "prep_overrun":
      return `The food took longer than expected; the ready time moved to ${atTime(str(data, "new"))}.`;
    case "eta_increased": {
      const later = numeric(data, "increase_seconds");
      return later === null ? "The rider is running later than first expected." : `The rider is running about ${formatWaiting(later)} later than first expected.`;
    }
    case "rider_at_vendor": {
      const wait = numeric(data, "wait_seconds");
      if (wait === null) return `${rider} arrived at the store.`;
      if (wait >= 60) return `${rider} arrived at the store; the food had been ready for ${formatWaiting(wait)}.`;
      if (wait <= -60) return `${rider} arrived at the store and waited ${formatWaiting(-wait)} for the food.`;
      return `${rider} arrived at the store just as the food was ready.`;
    }
    case "push_failed":
      return "The phone alert to the rider could not be sent.";
    case "tick_lag":
      return null;
    default:
      return event.replaceAll("_", " ");
  }
}

/** Reads the admin_dispatch_order_history() document. A malformed one is an error, not an empty history. */
export function readDispatchHistory(data: unknown): DispatchHistory {
  const parsed = historySchema.safeParse(data);
  if (!parsed.success) throw new Error("admin_dispatch_order_history returned an unexpected shape");
  const { order, dispatch } = parsed.data;

  const offers: HistoryOffer[] = (parsed.data.offers ?? []).map((offer) => ({
    offerId: offer.offer_id,
    riderName: offer.rider_name ?? "A rider",
    roundNo: num(offer.cycle_no) ?? 0,
    attemptNo: num(offer.attempt_no) ?? 0,
    distanceM: num(offer.distance_m),
    etaSeconds: num(offer.eta_seconds),
    status: offer.status,
    outcome: describeOfferOutcome(offer.status, offer.close_reason ?? null),
    offeredAt: offer.offered_at ?? null,
    secondsToRespond: num(offer.seconds_to_respond),
  }));

  const nameById = new Map<string, string>();
  for (const offer of parsed.data.offers ?? []) {
    if (offer.rider_id && offer.rider_name) nameById.set(offer.rider_id, offer.rider_name);
  }

  const events: HistoryEvent[] = [];
  for (const event of parsed.data.events ?? []) {
    const rider = (event.rider_id && nameById.get(event.rider_id)) || "A rider";
    const sentence = describeDispatchEvent(event.event, rider, event.data ?? {});
    if (sentence) events.push({ at: event.at, text: sentence });
  }

  return {
    orderCode: order?.code ?? null,
    orderStatus: order?.status ?? null,
    deliveredByStore: order?.delivery_by === "vendor",
    stateText: describeState(dispatch?.state, dispatch?.attention_reason),
    roundNo: num(dispatch?.cycle_no) ?? 0,
    expectedReadyAt: dispatch?.expected_ready_at ?? null,
    startAt: dispatch?.start_at ?? null,
    assignedAt: dispatch?.assigned_at ?? null,
    assignedEtaAt: dispatch?.assigned_eta_at ?? null,
    currentEtaAt: dispatch?.current_eta_at ?? null,
    riderArrivedAt: dispatch?.rider_arrived_vendor_at ?? null,
    offers,
    events,
  };
}

/** "34 s" or "1 min 5 s" for how long a rider took to answer; null when they did not. */
export function formatResponseTime(seconds: number | null): string | null {
  if (seconds === null) return null;
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded} s`;
  const rest = rounded % 60;
  return rest === 0 ? `${Math.floor(rounded / 60)} min` : `${Math.floor(rounded / 60)} min ${rest} s`;
}
