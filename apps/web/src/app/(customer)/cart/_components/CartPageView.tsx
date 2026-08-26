// app/(customer)/cart/_components/CartPageView.tsx
"use client";

import { EmptyState, buttonVariants } from "@kiakia/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CartDesktop } from "./CartDesktop";
import { CartMobile } from "./CartMobile";

interface CartItemRow {
  readonly id: string;
  readonly menu_item_id: string;
  readonly name_snapshot: string;
  readonly unit_price_kobo: number;
  readonly qty: number;
  readonly options_snapshot: unknown;
  readonly line_total_kobo: number;
}

interface CartPageViewProps {
  items: CartItemRow[];
  vendor: { id: string; name: string } | null;
}

/**
 * Thin client shell around the drawer components CartFab/CartDrawer already
 * use — cart state lives in Supabase (carts/cart_items), mutated directly
 * from the client per lib/cart.ts, not through a Server Action. Reusing
 * CartDesktop/CartMobile here (rather than the unused CartView/CartContent)
 * keeps /cart and the drawer in visual sync. `onClose` sends the customer
 * back to /home (there's nothing to "close" to on a dedicated page);
 * `onUpdate` re-runs the server fetch in page.tsx so both layouts reflect
 * mutations, matching the router.refresh() pattern used elsewhere
 * (AddressList, CartMobile's own internal calls).
 */
export function CartPageView({ items, vendor }: CartPageViewProps) {
  const router = useRouter();

  const goHome = () => router.push("/home");
  const refresh = () => router.refresh();

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
        <CartDesktop items={items} vendor={vendor} onClose={goHome} onUpdate={refresh} />
      </div>
      <div className="md:hidden">
        <CartMobile items={items} vendor={vendor} onClose={goHome} onUpdate={refresh} />
      </div>
    </>
  );
}
