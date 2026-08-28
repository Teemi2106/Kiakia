// app/(customer)/cart/_components/CartPageView.tsx
"use client";

import { useState } from "react";
import { EmptyState, buttonVariants } from "@kiakia/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CartLineItem } from "@/lib/cart";
import { useCart } from "./CartProvider";
import { useOptimisticCartMutations } from "./useOptimisticCartMutations";
import { CartDesktop } from "./CartDesktop";
import { CartMobile } from "./CartMobile";

interface CartPageViewProps {
  items: CartLineItem[];
  vendor: { id: string; name: string } | null;
}

/**
 * Thin client shell around the drawer components CartFab/CartDrawer already
 * use — cart state lives in Supabase (carts/cart_items), mutated directly
 * from the client per lib/cart.ts, not through a Server Action. Reusing
 * CartDesktop/CartMobile here keeps /cart and the drawer in visual sync.
 *
 * Quantity changes are optimistic (see useOptimisticCartMutations) — this
 * used to call `router.refresh()` (a full server round-trip re-rendering
 * the whole page) on every single +/- tap, which is exactly the kind of
 * sluggish, non-instant UX this was rebuilt to avoid. `router.refresh()`
 * is now reserved for the rare failure path, to reconcile local state with
 * whatever the server actually has.
 */
export function CartPageView({ items: initialItems, vendor }: CartPageViewProps) {
  const router = useRouter();
  const { refreshCart } = useCart();
  const [items, setItems] = useState(initialItems);

  const goHome = () => router.push("/home");

  const { pendingId, changeQty, remove, clearAll } = useOptimisticCartMutations(items, setItems, {
    onError: () => router.refresh(),
    onMutated: refreshCart, // keeps the header badge/CartFab count in sync
  });

  if (items.length === 0 || !vendor) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-7xl flex-1 items-center justify-center px-4 py-12">
        <EmptyState
          title="Your cart is empty"
          description="Browse vendors and add something to get started."
          action={
            <Link href="/home" className={buttonVariants({ variant: "primary" })}>
              Browse vendors
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <CartDesktop items={items} vendor={vendor} onClose={goHome} pendingId={pendingId} onQtyChange={changeQty} onRemove={remove} />
      </div>
      <div className="md:hidden">
        <CartMobile
          items={items}
          vendor={vendor}
          onClose={goHome}
          pendingId={pendingId}
          onQtyChange={changeQty}
          onRemove={remove}
          onClearAll={clearAll}
        />
      </div>
    </>
  );
}
