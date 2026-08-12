// app/(customer)/_components/CartProvider.tsx
"use client";

import { createContext, useContext, useState } from "react";
import { CartDrawer } from "./CartDrawer";

interface CartContextType {
  openCart: () => void;
  closeCart: () => void;
  refreshCart: () => void;
  refreshKey: number; // Add this
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshCart = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <CartContext.Provider
      value={{
        openCart: () => setIsOpen(true),
        closeCart: () => setIsOpen(false),
        refreshCart,
        refreshKey, // Expose this
      }}
    >
      {children}
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
