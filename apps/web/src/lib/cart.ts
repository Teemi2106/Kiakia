"use client";

import { createClient } from "./supabase/client";

/**
 * Client-side cart mutations, straight through RLS ("manage own cart" /
 * "manage own cart items" in 0007_rls.sql permit this directly — carts are
 * client-owned scratch state, not a financial record; `place_order()`
 * re-derives every price from live menu/options data regardless of what's
 * written here, per §9/§12's "never trust the client" rule). No Server
 * Action round trip for add/remove/qty-change, matching the pattern
 * already established for addresses and profile edits in Phase 0.
 */

export interface CartOptionSelection {
  readonly optionId: string;
  readonly name: string;
  readonly priceDeltaKobo: number;
}

export interface AddToCartInput {
  readonly vendorId: string;
  readonly menuItemId: string;
  readonly name: string;
  /** Base price + selected options — display/snapshot only, re-derived server-side at checkout. */
  readonly unitPriceKobo: number;
  readonly qty: number;
  readonly options: readonly CartOptionSelection[];
}

export type CartResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function getOpenCart(customerId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("carts")
    .select("id, vendor_id")
    .eq("customer_id", customerId)
    .eq("status", "open")
    .maybeSingle();
  return data;
}

/**
 * Adds an item to the customer's open cart. If that cart belongs to a
 * *different* vendor, confirms with the customer before retiring it and
 * starting a fresh one — the single-vendor guard from §9, surfaced as
 * "Clear your cart to order from X?" (a native confirm(), not a custom
 * dialog component — functionally correct, simpler than building a modal
 * for one yes/no decision).
 */
export async function addToCart(input: AddToCartInput): Promise<CartResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Please sign in first." };
  }

  let cart = await getOpenCart(user.id);

  if (cart && cart.vendor_id && cart.vendor_id !== input.vendorId) {
    const confirmed = window.confirm(
      `Your cart has items from another restaurant. Clear it and start a new order with ${input.name}?`,
    );
    if (!confirmed) {
      return { ok: false, error: "cancelled" };
    }

    await supabase.from("carts").update({ status: "abandoned" }).eq("id", cart.id);
    cart = null;
  }

  if (!cart) {
    const { data: newCart, error } = await supabase
      .from("carts")
      .insert({ customer_id: user.id, vendor_id: input.vendorId, status: "open" })
      .select("id, vendor_id")
      .single();

    if (error || !newCart) {
      return { ok: false, error: "Could not start a new cart." };
    }
    cart = newCart;
  }

  const { error } = await supabase.from("cart_items").insert({
    cart_id: cart.id,
    menu_item_id: input.menuItemId,
    name_snapshot: input.name,
    unit_price_kobo: input.unitPriceKobo,
    qty: input.qty,
    options_snapshot: input.options.map((o) => ({
      optionId: o.optionId,
      name: o.name,
      priceDeltaKobo: o.priceDeltaKobo,
    })),
    line_total_kobo: input.unitPriceKobo * input.qty,
  });

  if (error) {
    return { ok: false, error: "Could not add item to cart." };
  }

  return { ok: true, data: undefined };
}

export async function updateCartItemQty(itemId: string, qty: number): Promise<CartResult> {
  if (qty <= 0) {
    return removeCartItem(itemId);
  }

  const supabase = createClient();
  const { data: item } = await supabase.from("cart_items").select("unit_price_kobo").eq("id", itemId).single();
  if (!item) {
    return { ok: false, error: "Item not found." };
  }

  const { error } = await supabase
    .from("cart_items")
    .update({ qty, line_total_kobo: item.unit_price_kobo * qty })
    .eq("id", itemId);

  if (error) {
    return { ok: false, error: "Could not update quantity." };
  }

  return { ok: true, data: undefined };
}

export async function removeCartItem(itemId: string): Promise<CartResult> {
  const supabase = createClient();
  const { error } = await supabase.from("cart_items").delete().eq("id", itemId);

  if (error) {
    return { ok: false, error: "Could not remove item." };
  }

  return { ok: true, data: undefined };
}
