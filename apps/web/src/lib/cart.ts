"use client";

import type { Json } from "@kiakia/db";
import { createClient } from "./supabase/client";

/**
 * Client-side cart writes, straight through RLS ("manage own cart" /
 * "manage own cart items" in 0007_rls.sql permit this directly — carts are
 * client-owned scratch state, not a financial record; `place_order()`
 * re-derives every price from live menu/options data regardless of what's
 * written here, per §9/§12's "never trust the client" rule). No Server
 * Action round trip for add/remove/qty-change, matching the pattern
 * already established for addresses and profile edits in Phase 0.
 *
 * Each function is exactly one round trip and takes ids the caller already
 * holds. Orchestration (optimism, ordering, the single-vendor guard) lives in
 * lib/customer/store.ts, which is the only caller.
 */

export interface CartOptionSelection {
  readonly optionId: string;
  readonly name: string;
  readonly priceDeltaKobo: number;
}

/** Canonical cart line shape, as customer_bootstrap() returns it and as the
 * drawer and the /cart page render it.
 *
 * `menu_item_image_url` is not a cart_items column — it comes from the
 * bootstrap's menu_items join. Null when the menu item has no image. */
export interface CartLineItem {
  readonly id: string;
  readonly menu_item_id: string;
  readonly menu_item_image_url: string | null;
  readonly name_snapshot: string;
  readonly unit_price_kobo: number;
  readonly qty: number;
  readonly options_snapshot: Json; // see formatCartItemOptions() below
  readonly line_total_kobo: number;
}

/** cart_items has no image column and no plain "options" string column —
 * only `options_snapshot` (this shape). Formats it for display; returns
 * undefined for a plain item with no customization. */
export function formatCartItemOptions(snapshot: unknown): string | undefined {
  if (!Array.isArray(snapshot) || snapshot.length === 0) return undefined;
  const names = (snapshot as Partial<CartOptionSelection>[])
    .map((o) => o?.name)
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(", ") : undefined;
}

export type CartResult = { ok: true } | { ok: false; error: string };

const OK: CartResult = { ok: true };

function failed(error: { message: string } | null, message: string): CartResult {
  return error ? { ok: false, error: message } : OK;
}

/** Ids are minted by the caller so a line can be shown, and edited, before
 * its insert has come back. */
export async function createCart(cartId: string, customerId: string, vendorId: string): Promise<CartResult> {
  const { error } = await createClient()
    .from("carts")
    .insert({ id: cartId, customer_id: customerId, vendor_id: vendorId, status: "open" });
  return failed(error, "Could not start a new cart.");
}

export async function abandonCart(cartId: string): Promise<CartResult> {
  const { error } = await createClient().from("carts").update({ status: "abandoned" }).eq("id", cartId);
  return failed(error, "Could not clear your cart.");
}

export async function insertCartLine(cartId: string, line: CartLineItem): Promise<CartResult> {
  const { error } = await createClient().from("cart_items").insert({
    id: line.id,
    cart_id: cartId,
    menu_item_id: line.menu_item_id,
    name_snapshot: line.name_snapshot,
    unit_price_kobo: line.unit_price_kobo,
    qty: line.qty,
    options_snapshot: line.options_snapshot,
    line_total_kobo: line.line_total_kobo,
  });
  return failed(error, "Could not add item to cart.");
}

/** `unitPriceKobo` only feeds the display total — place_order() re-derives every price. */
export async function setCartLineQty(lineId: string, qty: number, unitPriceKobo: number): Promise<CartResult> {
  const { error } = await createClient()
    .from("cart_items")
    .update({ qty, line_total_kobo: unitPriceKobo * qty })
    .eq("id", lineId);
  return failed(error, "Could not update quantity.");
}

export async function deleteCartLine(lineId: string): Promise<CartResult> {
  const { error } = await createClient().from("cart_items").delete().eq("id", lineId);
  return failed(error, "Could not remove item.");
}

export async function deleteAllCartLines(cartId: string): Promise<CartResult> {
  const { error } = await createClient().from("cart_items").delete().eq("cart_id", cartId);
  return failed(error, "Could not clear your cart.");
}
