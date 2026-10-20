// app/(customer)/cart/_components/CartPanels.tsx
"use client";

import { useCustomerStore } from "@/lib/customer/CustomerStoreProvider";
import { CartDesktop } from "./CartDesktop";
import { CartMobile } from "./CartMobile";

/**
 * The non-empty cart, rendered from the customer store. Shared by the drawer
 * and the dedicated /cart page so the two stay in visual sync; every tap is
 * an optimistic store action (see lib/customer/store.ts), so nothing here
 * fetches or waits.
 */
export function CartPanels({ onClose }: { onClose: () => void }) {
  const cart = useCustomerStore((s) => s.cart);
  const lines = useCustomerStore((s) => s.lines);
  const setQty = useCustomerStore((s) => s.setQty);
  const removeLine = useCustomerStore((s) => s.removeLine);
  const clearCart = useCustomerStore((s) => s.clearCart);

  if (!cart) return null;
  const vendor = { id: cart.vendorId, name: cart.vendorName };

  return (
    <>
      <div className="hidden md:block">
        <CartDesktop items={lines} vendor={vendor} onClose={onClose} onQtyChange={setQty} onRemove={removeLine} />
      </div>
      <div className="md:hidden">
        <CartMobile
          items={lines}
          vendor={vendor}
          onClose={onClose}
          onQtyChange={setQty}
          onRemove={removeLine}
          onClearAll={clearCart}
        />
      </div>
    </>
  );
}
