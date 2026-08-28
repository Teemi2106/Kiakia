// app/(customer)/cart/_components/CartFab.tsx
"use client";

import { ShoppingCart } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCart } from "./CartProvider";

/**
 * Floating shortcut to the cart, so a customer mid-browse doesn't have to
 * scroll back up to the header. Only shown once there's something to check
 * out, and hidden while the drawer itself is open (it would sit under the
 * overlay on desktop, and behind the full-screen panel on mobile) or while
 * already on the cart/checkout pages themselves.
 */
export function CartFab() {
  const { itemCount, isOpen, openCart } = useCart();
  const pathname = usePathname();

  if (itemCount === 0 || isOpen) return null;
  if (pathname.startsWith("/cart") || pathname.startsWith("/checkout"))
    return null;

  return (
    <button
      onClick={openCart}
      aria-label={`Open cart, ${itemCount} ${itemCount === 1 ? "item" : "items"}`}
      // Clears the bottom tab bar, which is now visible right up to `lg` —
      // at `sm:bottom-6` this used to sit on top of it on tablets.
      className="fixed bottom-20 right-4 z-30 flex size-14 items-center justify-center rounded-full bg-kk-red text-white shadow-[0_14px_28px_-10px_rgba(182,25,19,0.7)] transition-transform hover:scale-105 hover:bg-kk-red-deep active:scale-95 lg:bottom-6 lg:right-6"
    >
      <ShoppingCart className="size-6" />
      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-kk-orange px-1 font-inter text-[11px] font-bold text-kk-orange-deep">
        {itemCount > 99 ? "99+" : itemCount}
      </span>
    </button>
  );
}
