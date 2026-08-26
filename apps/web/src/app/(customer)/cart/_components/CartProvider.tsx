// app/(customer)/_components/CartProvider.tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CartDrawer } from "./CartDrawer";
import { CartFab } from "./CartFab";

interface CartContextType {
  isOpen: boolean;
  itemCount: number;
  openCart: () => void;
  closeCart: () => void;
  refreshCart: () => void;
  refreshKey: number; // Add this
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [itemCount, setItemCount] = useState(0);
  const pathname = usePathname();

  const refreshCart = () => {
    setRefreshKey((prev) => prev + 1);
  };

  // Keep the floating cart button's badge in sync with the open cart,
  // independent of whether the drawer is mounted/open.
  useEffect(() => {
    let cancelled = false;

    async function fetchItemCount() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setItemCount(0);
        return;
      }

      const { data: cart } = await supabase
        .from("carts")
        .select("id")
        .eq("customer_id", user.id)
        .eq("status", "open")
        .maybeSingle();

      if (!cart) {
        if (!cancelled) setItemCount(0);
        return;
      }

      const { data: items } = await supabase
        .from("cart_items")
        .select("qty")
        .eq("cart_id", cart.id);

      if (!cancelled) {
        setItemCount((items || []).reduce((sum, item) => sum + item.qty, 0));
      }
    }

    void fetchItemCount();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, pathname]);

  return (
    <CartContext.Provider
      value={{
        isOpen,
        itemCount,
        openCart: () => setIsOpen(true),
        closeCart: () => setIsOpen(false),
        refreshCart,
        refreshKey, // Expose this
      }}
    >
      {children}
      <CartFab />
      <CartDrawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onUpdate={refreshCart}
      />
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider");
  return context;
}
