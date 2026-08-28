// app/(customer)/cart/_components/useOptimisticCartMutations.ts
"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { removeCartItem, updateCartItemQty, type CartLineItem } from "@/lib/cart";

/**
 * Shared quantity-change/remove/clear-all logic for both the cart drawer
 * and the dedicated /cart page — the visible change is applied to `items`
 * immediately (optimistic), the actual Supabase write happens after in the
 * background. `pendingId` only disables the one row mid-request (to stop a
 * double-tap race), never the rest of the cart. This replaces a prior
 * pattern where every quantity change either re-fetched the whole cart
 * behind a full-screen "Loading your cart..." spinner (the drawer) or
 * called `router.refresh()` — a full server round-trip — for a single +/-
 * tap (the /cart page).
 */
export function useOptimisticCartMutations(
  items: CartLineItem[],
  setItems: Dispatch<SetStateAction<CartLineItem[]>>,
  options?: { onMutated?: () => void; onError?: () => void | Promise<void> },
) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function changeQty(id: string, qty: number) {
    if (qty < 0) return;

    setItems((prev) =>
      qty === 0
        ? prev.filter((item) => item.id !== id)
        : prev.map((item) => (item.id === id ? { ...item, qty, line_total_kobo: item.unit_price_kobo * qty } : item)),
    );

    setPendingId(id);
    const result = qty === 0 ? await removeCartItem(id) : await updateCartItemQty(id, qty);
    setPendingId(null);

    if (!result.ok) await options?.onError?.();
    options?.onMutated?.();
  }

  async function remove(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setPendingId(id);
    const result = await removeCartItem(id);
    setPendingId(null);

    if (!result.ok) await options?.onError?.();
    options?.onMutated?.();
  }

  async function clearAll() {
    const removedIds = items.map((item) => item.id);
    setItems([]);
    const results = await Promise.all(removedIds.map((id) => removeCartItem(id)));
    if (results.some((r) => !r.ok)) await options?.onError?.();
    options?.onMutated?.();
  }

  return { pendingId, changeQty, remove, clearAll };
}
