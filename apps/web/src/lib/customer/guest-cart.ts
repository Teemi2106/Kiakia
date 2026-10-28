import { MAX_CART_ITEM_QTY } from "@kiakia/domain";
import type { CartLineItem } from "@/lib/cart";
import type { CartMeta } from "./types";

/**
 * A signed-out visitor's cart. It lives in this browser's localStorage, never
 * in the database (carts are keyed by an account), and is folded into the real
 * cart the first time that browser is signed in (store.mergeGuestCart).
 * Prices here are display-only, same as a signed-in cart: place_order()
 * re-derives every one from live menu data, so nothing read back from
 * localStorage is trusted for money.
 */

/** The store's userId while nobody is signed in. Never a real auth id. */
export const GUEST_USER_ID = "guest";

const STORAGE_KEY = "kk_guest_cart_v1";

export interface GuestCart {
  readonly cart: CartMeta;
  readonly lines: readonly CartLineItem[];
}

function isLine(value: unknown): value is CartLineItem {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Partial<CartLineItem>;
  return (
    typeof line.id === "string" &&
    typeof line.menu_item_id === "string" &&
    typeof line.name_snapshot === "string" &&
    typeof line.unit_price_kobo === "number" &&
    Number.isFinite(line.unit_price_kobo) &&
    typeof line.qty === "number" &&
    Number.isInteger(line.qty) &&
    line.qty >= 1 &&
    line.qty <= MAX_CART_ITEM_QTY
  );
}

export function readGuestCart(): GuestCart | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { cart, lines } = JSON.parse(raw) as { cart?: Partial<CartMeta>; lines?: unknown };
    if (!cart || typeof cart.id !== "string" || typeof cart.vendorId !== "string" || !Array.isArray(lines)) {
      return null;
    }
    const valid = lines.filter(isLine);
    if (valid.length === 0) return null;
    return { cart: { id: cart.id, vendorId: cart.vendorId, vendorName: cart.vendorName ?? "" }, lines: valid };
  } catch {
    return null;
  }
}

/** An empty cart removes the entry rather than storing a husk. */
export function writeGuestCart(cart: CartMeta | null, lines: readonly CartLineItem[]): void {
  try {
    if (!cart || lines.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ cart, lines }));
  } catch {
    // Storage full or blocked (private mode): the cart still works for this
    // page view, it just won't survive a reload.
  }
}

export function clearGuestCart(): void {
  writeGuestCart(null, []);
}
