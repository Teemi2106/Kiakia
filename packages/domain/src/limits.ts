import { type Kobo, koboOf } from "./money";

/**
 * Input ceilings enforced in BOTH places that matter: here, so the UI and
 * Server Actions reject bad input with a readable message, and in
 * supabase/migrations/0077_input_and_exposure_hardening.sql, so a direct
 * client write cannot get around them. Change one, change the other.
 */

/** Highest menu item price or option surcharge: NGN 1,000,000. */
export const MAX_MENU_PRICE_KOBO = 100_000_000;

/** Highest quantity of one line in a cart. */
export const MAX_CART_ITEM_QTY = 99;

/**
 * Turns what a vendor typed into the price field (Naira) into whole kobo, or
 * null when it is not a usable price: not a number, not a whole number of
 * kobo (0.004 would silently round to a free item), below 1 kobo, or above
 * MAX_MENU_PRICE_KOBO.
 */
export function parseMenuPriceKobo(input: unknown): Kobo | null {
  if (typeof input !== "number" && typeof input !== "string") return null;
  if (typeof input === "string" && input.trim() === "") return null;

  const naira = Number(input);
  if (!Number.isFinite(naira)) return null;

  const scaled = naira * 100;
  const kobo = Math.round(scaled);
  if (Math.abs(scaled - kobo) > 1e-6) return null;
  if (!Number.isSafeInteger(kobo) || kobo < 1 || kobo > MAX_MENU_PRICE_KOBO) return null;

  return koboOf(kobo);
}
