// app/(customer)/cart/_components/CartDrawer.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCart } from "./CartProvider";
import { X } from "lucide-react";
import { CartDesktop } from "./CartDesktop";
import { CartMobile } from "./CartMobile";

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}

export function CartDrawer({ isOpen, onClose, onUpdate }: CartDrawerProps) {
  const [items, setItems] = useState<any[]>([]);
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const { refreshKey } = useCart();

  useEffect(() => {
    if (!isOpen) return;

    async function fetchCart() {
      setLoading(true);
      const supabase = createClient();

      // Get the current user
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      // Get the open cart
      const { data: cart } = await supabase
        .from("carts")
        .select("id, vendor_id")
        .eq("customer_id", user.id)
        .eq("status", "open")
        .maybeSingle();

      if (!cart || !cart.vendor_id) {
        setItems([]);
        setVendor(null);
        setLoading(false);
        return;
      }

      // Get vendor details
      const { data: vendorData } = await supabase
        .from("vendors")
        .select("id, name")
        .eq("id", cart.vendor_id)
        .single();

      // Get cart items
      const { data: cartItems } = await supabase
        .from("cart_items")
        .select(
          "id, menu_item_id, name_snapshot, unit_price_kobo, qty, options_snapshot, line_total_kobo",
        )
        .eq("cart_id", cart.id);

      setItems(cartItems || []);
      setVendor(vendorData || null);
      setLoading(false);
    }

    fetchCart();
  }, [isOpen, refreshKey]); // Re-fetch when cart opens or refreshKey changes

  if (!isOpen) return null;

  // Show loading state
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
        <CartDesktop
          items={items}
          vendor={vendor}
          onClose={onClose}
          onUpdate={onUpdate}
        />
      </div>
      <div className="md:hidden">
        <CartMobile
          items={items}
          vendor={vendor}
          onClose={onClose}
          onUpdate={onUpdate}
        />
      </div>
    </>
  );
}
