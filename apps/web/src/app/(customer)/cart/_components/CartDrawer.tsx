// app/(customer)/cart/_components/CartDrawer.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CartLineItem } from "@/lib/cart";
import { useCart } from "./CartProvider";
import { useOptimisticCartMutations } from "./useOptimisticCartMutations";
import { X } from "lucide-react";
import { CartDesktop } from "./CartDesktop";
import { CartMobile } from "./CartMobile";

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}

export function CartDrawer({ isOpen, onClose, onUpdate }: CartDrawerProps) {
  const [items, setItems] = useState<CartLineItem[]>([]);
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const { refreshCart } = useCart();

  // Pure fetch, no setState — called both from the mount/open effect below
  // and from the optimistic-mutation hook's error-recovery path. Kept
  // state-free so the effect can do its own inline setState instead of
  // passing a state-setting function reference into it, which is what
  // tripped `react-hooks/set-state-in-effect` here previously (same fix as
  // VendorMenu.tsx's fetchCartLines this session).
  async function fetchCartData(): Promise<{ items: CartLineItem[]; vendor: { id: string; name: string } | null }> {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { items: [], vendor: null };

    const { data: cart } = await supabase
      .from("carts")
      .select("id, vendor_id")
      .eq("customer_id", user.id)
      .eq("status", "open")
      .maybeSingle();
    if (!cart || !cart.vendor_id) return { items: [], vendor: null };

    const [{ data: vendorData }, { data: cartItems }] = await Promise.all([
      supabase.from("vendors").select("id, name").eq("id", cart.vendor_id).single(),
      supabase.from("cart_items").select("id, menu_item_id, name_snapshot, unit_price_kobo, qty, options_snapshot, line_total_kobo").eq("cart_id", cart.id),
    ]);

    return { items: cartItems ?? [], vendor: vendorData ?? null };
  }

  // Fetch on every open (not just the first), since the cart can genuinely
  // change while the drawer is closed (e.g. adding an item from a vendor
  // page) — but never re-block on the full-screen spinner for it: `loading`
  // only starts true and is only ever set false, once, on the very first
  // fetch. Every later reopen silently refreshes `items`/`vendor` into the
  // background without hiding what's already on screen. This also no
  // longer depends on refreshKey — quantity changes are applied
  // optimistically (see useOptimisticCartMutations), so a mutation no
  // longer re-runs this effect at all, which is what used to make every
  // +/- tap block on "Loading your cart..." instead of feeling instant.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchCartData().then(({ items: fetched, vendor: fetchedVendor }) => {
      if (cancelled) return;
      setItems(fetched);
      setVendor(fetchedVendor);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const { pendingId, changeQty, remove, clearAll } = useOptimisticCartMutations(items, setItems, {
    // Silent re-fetch after a failed mutation — no spinner, just corrects
    // local state back to whatever the server actually has.
    onError: async () => {
      const { items: fetched, vendor: fetchedVendor } = await fetchCartData();
      setItems(fetched);
      setVendor(fetchedVendor);
    },
    onMutated: () => {
      refreshCart(); // syncs the header badge/CartFab count
      onUpdate?.();
    },
  });

  if (!isOpen) return null;

  // Show loading state (only ever true on the first open, see the effect above)
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#B61913] border-t-transparent" />
          <p className="mt-2 text-sm text-[#5B403C]">Loading your cart...</p>
        </div>
      </div>
    );
  }

  // Empty cart state
  if (!items.length || !vendor) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
        <div className="fixed right-0 top-0 z-50 flex h-full w-[420px] flex-col bg-white shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] md:block hidden">
          <div className="flex items-center justify-between border-b border-[#EAE7E7] px-6 py-5">
            <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
              Your Cart
            </h2>
            <button
              onClick={onClose}
              className="rounded-full p-2 hover:bg-black/5"
            >
              <X className="size-4 text-[#5B403C]" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="text-center text-[#5B403C]">Your cart is empty</p>
          </div>
        </div>
        {/* Mobile empty state */}
        <div className="fixed inset-0 z-50 flex flex-col bg-[#FCF9F8] md:hidden">
          <div className="flex items-center justify-between border-b border-[#EAE7E7] px-4 py-4">
            <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
              Your Cart
            </h2>
            <button
              onClick={onClose}
              className="rounded-full p-2 hover:bg-black/5"
            >
              <X className="size-4 text-[#5B403C]" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="text-center text-[#5B403C]">Your cart is empty</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <CartDesktop items={items} vendor={vendor} onClose={onClose} pendingId={pendingId} onQtyChange={changeQty} onRemove={remove} />
      </div>
      <div className="md:hidden">
        <CartMobile
          items={items}
          vendor={vendor}
          onClose={onClose}
          pendingId={pendingId}
          onQtyChange={changeQty}
          onRemove={remove}
          onClearAll={clearAll}
        />
      </div>
    </>
  );
}
