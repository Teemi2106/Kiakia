// app/(customer)/cart/page.tsx
import type { Metadata } from "next";
import { CartPageView } from "./_components/CartPageView";

export const metadata: Metadata = { title: "Cart" };

// The cart renders from the customer store the layout hydrates from
// customer_bootstrap(), so this page does no data fetching of its own.
export default function CartPage() {
  return <CartPageView />;
}
