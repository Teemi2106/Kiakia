import { EmptyState, buttonVariants } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { CartView } from "./_components/CartView";

export const metadata: Metadata = { title: "Cart" };

export default async function CartPage() {
  const session = await verifySession();
  const supabase = await createClient();

  const { data: cart } = await supabase
    .from("carts")
    .select("id, vendor_id")
    .eq("customer_id", session.userId)
    .eq("status", "open")
    .maybeSingle();

  if (!cart || !cart.vendor_id) {
    return (
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <h1 className="text-xl font-semibold text-ink">Your Cart</h1>
        <div className="mt-4">
          <EmptyState
            title="Your cart is empty"
            description="Browse vendors and add something to eat."
            action={
              <Link href="/home" className={buttonVariants({ variant: "primary" })}>
                Browse vendors
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const [{ data: vendor }, { data: items }] = await Promise.all([
    supabase.from("vendors").select("id, name").eq("id", cart.vendor_id).single(),
    supabase
      .from("cart_items")
      .select("id, menu_item_id, name_snapshot, unit_price_kobo, qty, options_snapshot, line_total_kobo")
      .eq("cart_id", cart.id),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">Your Cart</h1>
      {vendor && <p className="mt-1 text-sm text-ink-muted">from {vendor.name}</p>}
      <CartView items={items ?? []} />
    </div>
  );
}
