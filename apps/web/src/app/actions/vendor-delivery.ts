"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireVendorContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { parsePrepEstimateResult, prepEstimateErrorMessage, prepEstimateMessage, readyInMinutesSchema } from "@/lib/vendor/prep-estimate";
import { codeFailure, deliveryErrorMessage, expandResultMessage, parseExpandResult, retrySecondsFrom, type DeliveryActionResult } from "@/lib/vendor/self-delivery";

/**
 * Vendor "no rider near you" choice and self-delivery (0098). Every action runs
 * on the vendor's own session client (never service role): the RPCs check that
 * the caller is staff of this order's store and that the order is in the right
 * state, which is the real boundary. requireVendorContext() is the usual gate
 * for who may reach the action at all.
 */

const orderIdSchema = z.string().uuid("Invalid order");
const codeSchema = z.string().trim().regex(/^\d{4}$/, "Enter the 4-digit code the customer gives you.");
const advanceSchema = z.enum(["picked_up", "in_transit", "arrived"], { message: "Unknown step" });

function revalidateOrder(orderId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${orderId}`);
}

/** Asks for the rider search to go further, up to this store's own delivery distance. Rate-limited by the database. */
export async function expandRiderSearchAction(orderId: string): Promise<DeliveryActionResult> {
  await requireVendorContext();
  const id = orderIdSchema.safeParse(orderId);
  if (!id.success) return { ok: false, error: "Invalid order" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vendor_expand_rider_search", { p_order_id: id.data });
  if (error) {
    const retryInSeconds = error.code === "P0429" ? retrySecondsFrom(error.message) : null;
    return { ok: false, error: deliveryErrorMessage(error), ...(retryInSeconds === null ? {} : { retryInSeconds }) };
  }

  revalidateOrder(id.data);
  return { ok: true, message: expandResultMessage(parseExpandResult(data)) };
}

/**
 * "Need more time?": the store says the food will be ready in N minutes from now
 * (1-180). The database re-checks everything: that the caller is staff of this
 * store, that the order is still being prepared for a rider, the range, and the
 * limit on how often it can change. The rider, if one is assigned, is told there.
 */
export async function updatePrepEstimateAction(orderId: string, readyInMinutes: number): Promise<DeliveryActionResult> {
  await requireVendorContext();
  const id = orderIdSchema.safeParse(orderId);
  if (!id.success) return { ok: false, error: "Invalid order" };
  const minutes = readyInMinutesSchema.safeParse(readyInMinutes);
  if (!minutes.success) return { ok: false, error: minutes.error.issues[0]?.message ?? "Enter a valid time." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vendor_update_prep_estimate", { p_order_id: id.data, p_ready_in_minutes: minutes.data });
  if (error) return { ok: false, error: prepEstimateErrorMessage(error) };

  revalidateOrder(id.data);
  return { ok: true, message: prepEstimateMessage(parsePrepEstimateResult(data)) };
}

/** The store will deliver this order itself. Nobody else is sent it; the store keeps the delivery fee. */
export async function startSelfDeliveryAction(orderId: string): Promise<DeliveryActionResult> {
  await requireVendorContext();
  const id = orderIdSchema.safeParse(orderId);
  if (!id.success) return { ok: false, error: "Invalid order" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("vendor_start_self_delivery", { p_order_id: id.data });
  if (error) return { ok: false, error: deliveryErrorMessage(error) };

  revalidateOrder(id.data);
  return { ok: true, message: "You are delivering this order yourself." };
}

/** ready_for_pickup, then picked_up, in_transit and arrived, strictly in that order. */
export async function advanceSelfDeliveryAction(orderId: string, toStatus: "picked_up" | "in_transit" | "arrived"): Promise<DeliveryActionResult> {
  await requireVendorContext();
  const id = orderIdSchema.safeParse(orderId);
  const to = advanceSchema.safeParse(toStatus);
  if (!id.success || !to.success) return { ok: false, error: "Invalid request" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("vendor_advance_self_delivery", { p_order_id: id.data, p_to_status: to.data });
  if (error) return { ok: false, error: deliveryErrorMessage(error) };

  revalidateOrder(id.data);
  return { ok: true };
}

/** Checks the customer's delivery code. On success the money is released. Never optimistic. */
export async function completeSelfDeliveryAction(orderId: string, code: string): Promise<DeliveryActionResult> {
  await requireVendorContext();
  const id = orderIdSchema.safeParse(orderId);
  if (!id.success) return { ok: false, error: "Invalid order" };
  const parsedCode = codeSchema.safeParse(code);
  if (!parsedCode.success) return { ok: false, error: parsedCode.error.issues[0]?.message ?? "Enter the code." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vendor_complete_self_delivery", { p_order_id: id.data, p_code: parsedCode.data });

  // The lockout comes back as an error; a wrong code as {code_matched: false}.
  const lockedOut = error !== null && /locked|too many/i.test(error.message);
  const record = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  if (lockedOut || ("code_matched" in record && record.code_matched === false)) {
    const failure = codeFailure({ error });
    revalidateOrder(id.data);
    return { ok: false, error: failure.message, locked: failure.locked };
  }
  if (error) return { ok: false, error: deliveryErrorMessage(error) };

  revalidateOrder(id.data);
  return { ok: true };
}
