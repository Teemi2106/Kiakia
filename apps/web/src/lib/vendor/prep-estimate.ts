import { z } from "zod";
import { formatLagosTime, minutesUntil } from "../time";
import { deliveryErrorMessage } from "./self-delivery";

/**
 * "Need more time?": the store revises when the food will be ready
 * (vendor_update_prep_estimate, 0104). Pure and client-safe, so the control, the
 * Server Action and the tests share one set of rules and wording.
 */

export const MIN_READY_MINUTES = 1;
export const MAX_READY_MINUTES = 180;

/** The quick "add this much" buttons. */
export const PREP_EXTENSION_MINUTES = [5, 10, 15] as const;

export const readyInMinutesSchema = z
  .number({ message: "Enter the minutes as a number." })
  .int("Enter a whole number of minutes.")
  .min(MIN_READY_MINUTES, `Enter at least ${MIN_READY_MINUTES} minute.`)
  .max(MAX_READY_MINUTES, `Enter ${MAX_READY_MINUTES} minutes or fewer.`);

/** Only an order still being prepared, delivered by a rider, has a ready time to revise. */
export function canAdjustPrep(order: { status: string; deliveryBy?: "rider" | "vendor" }): boolean {
  return order.deliveryBy !== "vendor" && (order.status === "accepted" || order.status === "preparing");
}

/** What the vendor typed in "ready in N minutes": a whole number in range, or the reason it is not. */
export function parseReadyInMinutes(typed: string): { ok: true; minutes: number } | { ok: false; error: string } {
  const text = typed.trim();
  if (!/^\d{1,3}$/.test(text)) return { ok: false, error: "Enter the minutes as a whole number, for example 20." };
  const parsed = readyInMinutesSchema.safeParse(Number(text));
  return parsed.success ? { ok: true, minutes: parsed.data } : { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid time." };
}

/**
 * "Ready in N minutes" for a quick +5/+10/+15: the time still left on the
 * current estimate plus the extra, never more than the 180-minute limit. Null
 * when there is no current estimate to add to (the vendor types a time instead).
 */
export function extendedReadyMinutes(expectedReadyAt: string | null, extraMinutes: number, nowMs: number): number | null {
  const left = minutesUntil(expectedReadyAt, nowMs);
  return left === null ? null : Math.min(MAX_READY_MINUTES, left + extraMinutes);
}

export interface PrepEstimateResult {
  readonly expectedReadyAt: string | null;
  readonly riderNotified: boolean;
}

/** Reads the vendor_update_prep_estimate() result: {order_id, expected_ready_at, start_at, rider_notified}. */
export function parsePrepEstimateResult(data: unknown): PrepEstimateResult {
  const record = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return {
    expectedReadyAt: typeof record.expected_ready_at === "string" ? record.expected_ready_at : null,
    riderNotified: record.rider_notified === true,
  };
}

/** What the control reports after a change. */
export function prepEstimateMessage(result: PrepEstimateResult): string {
  const time = formatLagosTime(result.expectedReadyAt);
  const base = time ? `Got it. Food expected ready at ${time}.` : "Got it. The ready time is updated.";
  return result.riderNotified ? `${base} Your rider has been told.` : base;
}

interface RpcError {
  readonly message: string;
  readonly code?: string;
}

/** A refused change in plain words; the generic delivery wording covers permission and unknown failures. */
export function prepEstimateErrorMessage(error: RpcError): string {
  if (error.code === "P0429") return "You have already changed the ready time several times for this order. Please contact KiaKia support if it needs to change again.";
  if (error.code === "23514" && /between 1 and 180/.test(error.message)) return `Enter a time between ${MIN_READY_MINUTES} and ${MAX_READY_MINUTES} minutes.`;
  return deliveryErrorMessage(error);
}
