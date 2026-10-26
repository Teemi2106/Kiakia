import { formatLagosTime, minutesUntil } from "../time";
import type { VendorDispatchState } from "./self-delivery";

/**
 * What the store sees about the rider search for an order, in plain words
 * (sequential dispatch, 0102/0104): while the food is still being prepared, while
 * riders are being asked one at a time, and once a rider is on the way. Pure, so
 * the status note and the tests say the same thing. Times are Lagos time.
 */

export const FINDING_RIDER_TEXT = "Finding a rider: asking riders one at a time, nearest first.";

/** Orders whose food is still being made: the ready time is an estimate the store can revise. */
const PREPARING = new Set(["accepted", "preparing"]);

/**
 * True once riders are being asked. A ready order starts at once; otherwise the
 * planned start time decides (the engine's own state can lag it by a tick), and
 * with no planned time the engine state does.
 */
export function searchHasStarted(dispatch: Pick<VendorDispatchState, "startAt" | "engineState">, status: string, nowMs: number): boolean {
  if (status === "ready_for_pickup") return true;
  if (dispatch.startAt) return Date.parse(dispatch.startAt) <= nowMs;
  return dispatch.engineState !== "scheduled";
}

/** "Rider arriving in about 7 min", or null when the arrival time is unknown. */
export function riderArrivalText(assignedEtaAt: string | null, nowMs: number): string | null {
  const minutes = minutesUntil(assignedEtaAt, nowMs);
  if (minutes === null) return null;
  return minutes === 0 ? "Your rider should be arriving about now." : `Rider arriving in about ${minutes} min`;
}

/** The status lines to show above the order's actions; empty when there is nothing useful to say. */
export function riderStatusLines(dispatch: VendorDispatchState, status: string, nowMs: number): string[] {
  if (dispatch.state === "rider_assigned") {
    const arrival = riderArrivalText(dispatch.assignedEtaAt, nowMs);
    return arrival ? [arrival] : [];
  }
  if (dispatch.state !== "offers_pending") return [];

  const ready = PREPARING.has(status) ? formatLagosTime(dispatch.expectedReadyAt) : null;
  const readyLine = ready ? `Food expected ready at ${ready}` : null;
  if (searchHasStarted(dispatch, status, nowMs)) return [FINDING_RIDER_TEXT, ...(readyLine ? [readyLine] : [])];

  const start = formatLagosTime(dispatch.startAt);
  return [...(readyLine ? [readyLine] : []), ...(start ? [`Rider search starts around ${start}`] : [])];
}
