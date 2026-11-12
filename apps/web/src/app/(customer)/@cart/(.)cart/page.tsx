"use client";

import { useEffect } from "react";
import { useCustomerStore } from "@/lib/customer/CustomerStoreProvider";
import { CartDrawer } from "../../cart/_components/CartDrawer";

export default function InterceptedCartPage() {
  const setCartOpen = useCustomerStore((state) => state.setCartOpen);

  useEffect(() => {
    setCartOpen(true);
    return () => setCartOpen(false);
  }, [setCartOpen]);

  // The customer layout owns the shared drawer used by the header button too.
  // This slot marks /cart as active while that shared drawer is visible.
  return null;
}
