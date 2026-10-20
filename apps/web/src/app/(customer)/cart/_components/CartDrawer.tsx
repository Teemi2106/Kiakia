// app/(customer)/cart/_components/CartDrawer.tsx
"use client";

import { X } from "lucide-react";
import { useCustomerStore } from "@/lib/customer/CustomerStoreProvider";
import { CartPanels } from "./CartPanels";

export function CartDrawer() {
  const isOpen = useCustomerStore((s) => s.cartOpen);
  const setCartOpen = useCustomerStore((s) => s.setCartOpen);
  const isEmpty = useCustomerStore((s) => s.lines.length === 0);

  if (!isOpen) return null;

  const onClose = () => setCartOpen(false);

  // Empty cart state
  if (isEmpty) {
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

  return <CartPanels onClose={onClose} />;
}
