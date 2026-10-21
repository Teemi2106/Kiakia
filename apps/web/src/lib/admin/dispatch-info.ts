import { formatKm } from "./dispatch-settings-info";

/**
 * Plain-language reading of one stuck order from admin_dispatch_status() (0097):
 * an order that is ready with no rider. Pure so the Waiting for a rider page,
 * the order page notice and the tests all say the same thing.
 */

export const WAITING_REASONS = [
  "offers_pending",
  "no_online_riders",
  "none_in_range",
  "fee_exceeds_order_budget",
  "all_declined_or_expired",
  "awaiting_dispatch",
] as const;
export type WaitingReason = (typeof WAITING_REASONS)[number];

export interface WaitingOrder {
  readonly orderId: string;
  readonly orderCode: string;
  readonly vendorId: string | null;
  readonly vendorName: string | null;
  readonly waitingSeconds: number;
  /** Riders online across KiaKia (not just for this order). */
  readonly ridersOnline: number;
  /** Riders within the first-round distance (all riders when there is no limit). */
  readonly ridersWithinRadius: number;
  /** Riders within this store's own delivery distance (where the search widens to). */
  readonly ridersWithinStoreRadius: number;
  /** Distance from the store to the nearest online rider, null when nobody is online. */
  readonly nearestRiderM: number | null;
  readonly offersOpen: number;
  readonly offersMade: number;
  /** The first-round distance. 0 = no limit. */
  readonly radiusM: number;
  /** How far this store delivers (vendors.delivery_radius_m): the search widens to this. */
  readonly storeRadiusM: number | null;
  /** True once the search has widened to the store's own distance. */
  readonly widened: boolean;
  readonly lastAttempt: { readonly at: string; readonly radiusM: number | null; readonly ridersInRange: number; readonly offersCreated: number } | null;
  readonly reason: WaitingReason;
}

/** Raw shape of admin_dispatch_status() (jsonb). */
export interface DispatchStatusPayload {
  settings?: { radius_m?: number } | null;
  online_riders?: number | null;
  stuck_orders?: DispatchStatusOrder[] | null;
}

export interface DispatchStatusOrder {
  order_id: string;
  code?: string | null;
  vendor_id?: string | null;
  vendor_name?: string | null;
  waiting_since?: string | null;
  offers_made?: number | null;
  offers_open?: number | null;
  nearest_online_rider_m?: number | null;
  riders_within_radius?: number | null;
  /** Final field name is the backend's call; riders_within_widened_radius is the 0097 name for the same count. */
  riders_within_store_radius?: number | null;
  riders_within_widened_radius?: number | null;
  /** The store's own delivery radius (vendors.delivery_radius_m); widened_radius_m is accepted as the 0097-era name. */
  store_radius_m?: number | null;
  widened_radius_m?: number | null;
  radius_m?: number | null;
  last_attempt?: { at?: string; radius_m?: number | null; riders_in_range?: number; offers_created?: number } | null;
  reason?: string | null;
  widened?: boolean | null;
}

const num = (value: unknown, fallback = 0): number => {
  const n = typeof value === "number" ? value : Number(value);
  return value == null || !Number.isFinite(n) ? fallback : n;
};
const numOrNull = (value: unknown): number | null => (value == null || !Number.isFinite(Number(value)) ? null : Number(value));

export function mapStatusOrder(row: DispatchStatusOrder, payload: DispatchStatusPayload, nowMs: number): WaitingOrder {
  const since = row.waiting_since ? Date.parse(row.waiting_since) : NaN;
  const attempt = row.last_attempt;
  const reason = WAITING_REASONS.find((candidate) => candidate === row.reason) ?? "awaiting_dispatch";
  return {
    orderId: row.order_id,
    orderCode: row.code ?? row.order_id,
    vendorId: row.vendor_id ?? null,
    vendorName: row.vendor_name ?? null,
    waitingSeconds: Number.isFinite(since) ? Math.max(0, Math.floor((nowMs - since) / 1000)) : 0,
    ridersOnline: num(payload.online_riders),
    ridersWithinRadius: num(row.riders_within_radius),
    ridersWithinStoreRadius: num(row.riders_within_store_radius ?? row.riders_within_widened_radius),
    nearestRiderM: numOrNull(row.nearest_online_rider_m),
    offersOpen: num(row.offers_open),
    offersMade: num(row.offers_made),
    radiusM: num(row.radius_m ?? payload.settings?.radius_m),
    storeRadiusM: numOrNull(row.store_radius_m ?? row.widened_radius_m),
    widened: row.widened === true,
    lastAttempt:
      attempt && attempt.at
        ? { at: attempt.at, radiusM: numOrNull(attempt.radius_m), ridersInRange: num(attempt.riders_in_range), offersCreated: num(attempt.offers_created) }
        : null,
    reason,
  };
}

export function mapStatusPayload(payload: DispatchStatusPayload | null, nowMs = Date.now()): WaitingOrder[] {
  const rows = payload?.stuck_orders ?? [];
  return rows.map((row) => mapStatusOrder(row, payload ?? {}, nowMs));
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

export interface WaitingExplanation {
  readonly headline: string;
  /** What the admin can do about it, in words. */
  readonly action: string;
  /** True when the suggested action involves the Settings page, so the UI can link it. */
  readonly mentionsSettings: boolean;
}

/** The distance this order is searching right now, in words ("5 km", or "any distance"). */
function searchDistance(order: WaitingOrder): string {
  const metres = order.widened && order.storeRadiusM ? order.storeRadiusM : order.radiusM;
  return metres > 0 ? formatKm(metres) : "any distance";
}

/** "Looked within 5 km; this store delivers up to 20 km", the two distances in one line. */
export function describeDistances(order: WaitingOrder): string {
  const looked = order.radiusM > 0 ? `Looked within ${formatKm(order.radiusM)}` : "Looked at any distance";
  const store = order.storeRadiusM ? `this store delivers up to ${formatKm(order.storeRadiusM)}` : null;
  return store ? `${looked}; ${store}` : looked;
}

export function describeWaiting(order: WaitingOrder): WaitingExplanation {
  switch (order.reason) {
    case "offers_pending":
      return {
        headline: "Offers sent, waiting for a rider to accept.",
        action: "Give it a few minutes. If it stays like this, send it to riders again or assign a rider yourself from the order page.",
        mentionsSettings: false,
      };
    case "no_online_riders":
      return {
        headline: "No riders are online.",
        action: "Ask riders to go online, or assign a rider yourself from the order page.",
        mentionsSettings: false,
      };
    case "none_in_range": {
      const nearest = order.nearestRiderM;
      const within = `none within ${searchDistance(order)}`;
      const headline = nearest === null ? `Riders are online but ${within}.` : `Riders are online but ${within}: the nearest is ${formatKm(nearest)} away.`;
      const needed = nearest === null ? null : formatKm(Math.ceil(nearest / 1000) * 1000);
      return {
        headline,
        action: order.widened
          ? "The search already covers everything this store delivers to. Ask a rider to move closer, or assign a rider yourself from the order page."
          : `The search widens by itself to the store's own distance${order.storeRadiusM ? ` (${formatKm(order.storeRadiusM)})` : ""} after the wait set in Settings. You can also raise the first distance${needed ? ` (to at least ${needed})` : ""} in Settings, or ask a rider to move closer.`,
        mentionsSettings: true,
      };
    }
    case "fee_exceeds_order_budget":
      return {
        headline: "Riders are nearby, but this order is too small to cover what a rider would be paid for the trip.",
        action: "Assign a rider yourself from the order page, or ask the technical team to look at the delivery fee for this area.",
        mentionsSettings: false,
      };
    case "all_declined_or_expired":
      return {
        headline: "All offered riders declined or ran out of time.",
        action: "Send it to riders again, or assign a rider yourself from the order page.",
        mentionsSettings: false,
      };
    case "awaiting_dispatch":
      return {
        headline: "Not offered to anyone yet.",
        action: "The system sends offers every 15 seconds. If this does not change within a minute, send it to riders again.",
        mentionsSettings: false,
      };
  }
}

/** "Tried at 16:38: 0 riders within 5 km", or null when nothing was tried yet. */
export function describeLastAttempt(order: WaitingOrder, timeZone = "Africa/Lagos"): string | null {
  const attempt = order.lastAttempt;
  if (!attempt) return null;
  const time = new Date(attempt.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  const riders = attempt.ridersInRange === 1 ? "1 rider" : `${attempt.ridersInRange} riders`;
  const where = attempt.radiusM && attempt.radiusM > 0 ? `within ${formatKm(attempt.radiusM)}` : "at any distance";
  return `Tried at ${time}: ${riders} ${where}`;
}

/** What the Send to riders again button reports back. */
export function redispatchMessage(result: { offered: number; ridersInRange: number | null }): string {
  if (result.offered > 0) return result.offered === 1 ? "Sent to 1 rider." : `Sent to ${result.offered} riders.`;
  if (result.ridersInRange !== null && result.ridersInRange > 0) {
    return "Nobody was sent the order: riders are in range but none can take it right now (they may be busy, or the order is too small to pay them).";
  }
  return "No riders in range. Nobody was sent the order.";
}

/** Reads the result of admin_redispatch_order: {offers_created, riders_in_range}. */
export function parseRedispatchResult(data: unknown): { offered: number; ridersInRange: number | null } {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return { offered: num(record.offers_created), ridersInRange: numOrNull(record.riders_in_range) };
}
