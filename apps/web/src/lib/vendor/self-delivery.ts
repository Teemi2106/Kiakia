/**
 * Plain-language copy and parsing for the vendor "no rider near you" choice and
 * the self-delivery flow (migrations 0097/0098: vendor_dispatch_state,
 * vendor_expand_rider_search, vendor_start_self_delivery,
 * vendor_advance_self_delivery, vendor_complete_self_delivery). Pure, so the
 * banner, the actions and the tests say the same thing. No server-only imports.
 */

export const DISPATCH_STATE_NAMES = ["offers_pending", "no_rider_nearby", "rider_assigned", "self_delivery", "not_applicable"] as const;
export type DispatchStateName = (typeof DISPATCH_STATE_NAMES)[number];

/** The engine's own state for the order (order_dispatch.state, 0100). */
export const ENGINE_STATE_NAMES = ["scheduled", "searching", "offered", "assigned", "needs_attention", "stopped"] as const;
export type EngineStateName = (typeof ENGINE_STATE_NAMES)[number];

export interface VendorDispatchState {
  readonly state: DispatchStateName;
  readonly canExpand: boolean;
  /** Seconds until "Look further away" may be used again (0 = now, or never when canExpand is false and nothing is counting down). */
  readonly expandAvailableInSeconds: number;
  readonly ridersInRange: number;
  /** How far this store delivers; the wider search goes up to this. */
  readonly storeRadiusM: number | null;
  /** The distance being searched now (null = no limit). */
  readonly radiusM: number | null;
  /** The first-round distance setting (0 = no limit). */
  readonly baseRadiusM: number;
  readonly expansionsUsed: number;
  /** Where the search stands: not started yet, asking riders, rider assigned... Null when the order has no dispatch record. */
  readonly engineState: EngineStateName | null;
  /** When the food is expected ready, and when the rider search is planned to start (ISO). */
  readonly expectedReadyAt: string | null;
  readonly startAt: string | null;
  /** When the assigned rider is expected at the store (ISO). */
  readonly assignedEtaAt: string | null;
  /** The server's clock when this was read, so a countdown can start from the same moment. */
  readonly asOfMs: number;
}

const num = (value: unknown): number | null => (value == null || !Number.isFinite(Number(value)) ? null : Number(value));

const iso = (value: unknown): string | null => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null);

/** Reads the vendor_dispatch_state() result (an object, or a one-row array). Null when it is not a recognised state. */
export function parseDispatchState(data: unknown, asOfMs: number = Date.now()): VendorDispatchState | null {
  const raw = Array.isArray(data) ? data[0] : data;
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const state = DISPATCH_STATE_NAMES.find((name) => name === record.state);
  if (!state) return null;
  return {
    state,
    canExpand: record.can_expand === true,
    expandAvailableInSeconds: Math.max(0, Math.ceil(num(record.expand_available_in_seconds) ?? 0)),
    ridersInRange: num(record.riders_in_range) ?? 0,
    storeRadiusM: num(record.store_radius_m),
    radiusM: num(record.radius_m),
    baseRadiusM: num(record.base_radius_m) ?? 0,
    expansionsUsed: num(record.expansions_used) ?? 0,
    engineState: ENGINE_STATE_NAMES.find((name) => name === record.dispatch_state) ?? null,
    expectedReadyAt: iso(record.expected_ready_at),
    startAt: iso(record.start_at),
    assignedEtaAt: iso(record.assigned_eta_at),
    asOfMs,
  };
}

function km(metres: number): string {
  const value = metres / 1000;
  return `${Number.isInteger(value) ? value : Number(value.toFixed(1))} km`;
}

export const NO_RIDER_HEADLINE = "No rider is near you right now.";

/**
 * The question the banner asks. The "look further away" half is offered only
 * when the server says it is possible (a first-round distance is set and the
 * store delivers further than that); otherwise the choice is wait or deliver.
 */
export function bannerQuestion(state: Pick<VendorDispatchState, "storeRadiusM" | "canExpand" | "expandAvailableInSeconds">): string {
  if (!(state.canExpand || state.expandAvailableInSeconds > 0)) {
    return "Do you want to keep waiting for a rider, or will you deliver this order yourself?";
  }
  const further = state.storeRadiusM ? `look for riders further away (up to ${km(state.storeRadiusM)})` : "look for riders further away";
  return `Do you want us to ${further}, or will you deliver this order yourself?`;
}

export function expandLabel(state: Pick<VendorDispatchState, "storeRadiusM">): string {
  return state.storeRadiusM ? `Look further away (up to ${km(state.storeRadiusM)})` : "Look further away";
}

/** "0:45", "1:05": the rate-limit countdown on the Look further away button. */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export const SEARCHING_WIDER = "Searching wider…";

export const SELF_DELIVERY_CONFIRM_TEXT =
  "You will bring this order to the customer yourself. You keep the delivery fee, and no rider will be sent. This cannot be undone once you start.";

/** What "Look further away" reports back. */
export function expandResultMessage(result: { offered: number }): string {
  if (result.offered > 0) return result.offered === 1 ? "Sent to 1 rider." : `Sent to ${result.offered} riders.`;
  return "Still no riders; you can deliver it yourself.";
}

/** Reads the vendor_expand_rider_search() result: {offers_created, riders_in_range, ...}. */
export function parseExpandResult(data: unknown): { offered: number; ridersInRange: number | null } {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return { offered: num(record.offers_created ?? record.offered) ?? 0, ridersInRange: num(record.riders_in_range) };
}

interface RpcError {
  readonly message: string;
  readonly code?: string;
}

/** Seconds named in a "try again in N seconds" style message, or null. */
export function retrySecondsFrom(message: string): number | null {
  const match = /in\s+(\d+)\s*(?:s\b|sec)/i.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * Turns a vendor delivery RPC failure into a message that is safe to show. The
 * database's own range/state messages (check_violation) pass through minus the
 * "function_name: " prefix; permission and missing-order failures get fixed
 * wording; anything else is replaced, because a raw message can name tables.
 */
export function deliveryErrorMessage(error: RpcError): string {
  switch (error.code) {
    case "P0429": {
      const seconds = retrySecondsFrom(error.message);
      return seconds === null ? error.message.replace(/^[a-z_]+: /, "") : `Please wait ${seconds} seconds before searching again.`;
    }
    case "23514":
      return error.message.replace(/^[a-z_]+: /, "");
    case "42501":
      return "You don't have permission to do that for this order.";
    case "P0002":
      return "That order no longer exists.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export interface CodeFailure {
  readonly message: string;
  readonly locked: boolean;
}

const LOCKED_MESSAGE = "Too many wrong codes. This order is now locked. Please contact KiaKia support.";

/**
 * Plain wording for a refused delivery code. A wrong code comes back as
 * {code_matched: false} (the database counts the attempt but does not say how
 * many are left); after too many wrong tries the RPC raises an error that
 * mentions it, which means the order is locked.
 */
export function codeFailure(input: { data?: unknown; error?: RpcError | null }): CodeFailure {
  const text = input.error?.message ?? "";
  if (/locked|too many/i.test(text)) return { message: LOCKED_MESSAGE, locked: true };
  return {
    message: "That code is not right. Ask the customer to read it out again. After 5 wrong tries the order is locked and you will need to contact KiaKia support.",
    locked: false,
  };
}

export type SelfDeliveryStep = { readonly to: "picked_up" | "in_transit" | "arrived"; readonly label: string };

/**
 * The one button the vendor should press next, by the order's current status;
 * null while the food is still being prepared (the normal Mark ready button
 * comes first) and once it is time for the code. The database enforces the
 * order strictly: ready_for_pickup, picked_up, in_transit, arrived.
 */
export function nextSelfDeliveryStep(status: string): SelfDeliveryStep | null {
  switch (status) {
    case "ready_for_pickup":
      return { to: "picked_up", label: "I've picked it up" };
    case "picked_up":
      return { to: "in_transit", label: "I'm on my way" };
    case "in_transit":
      return { to: "arrived", label: "I've arrived" };
    default:
      return null;
  }
}

/** Result of a vendor delivery Server Action, shown by the buttons that triggered it. */
export interface DeliveryActionResult {
  readonly ok: boolean;
  readonly message?: string;
  readonly error?: string;
  readonly retryInSeconds?: number;
  readonly locked?: boolean;
}
