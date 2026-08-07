// app/(auth)/customer/cart/page.tsx
import { EmptyState, buttonVariants } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { CartDesktop } from "./_components/CartDesktop";
import { CartMobile } from "./_components/CartMobile";

export const metadata: Metadata = { title: "Cart" };

// Demo data
const DEMO_CART = {
  id: "demo-cart-1",
  vendor_id: "demo-vendor-1",
  vendor_name: "The Place",
};

const DEMO_CART_ITEMS = [
  {
    id: "item-1",
    name_snapshot: "Jollof Rice with Chicken",
    unit_price_kobo: 450000,
    qty: 2,
    line_total_kobo: 900000,
    image_url: null,
    options: "Large portion",
  },
  {
    id: "item-2",
    name_snapshot: "Moin Moin",
    unit_price_kobo: 200000,
    qty: 3,
    line_total_kobo: 600000,
    image_url: null,
    options: "With fish and egg",
  },
  {
    id: "item-3",
    name_snapshot: "Grilled Fish with Plantain",
    unit_price_kobo: 550000,
    qty: 1,
    line_total_kobo: 550000,
    image_url: null,
    options: "Spicy",
  },
];

export default async function CartPage() {
  const session = await verifySession();
  const supabase = await createClient();

  const useDemoData = true;

  let cart = null;
  let items = [];
  let vendor = null;

  if (useDemoData) {
    cart = DEMO_CART;
    items = DEMO_CART_ITEMS;
    vendor = { id: DEMO_CART.vendor_id, name: DEMO_CART.vendor_name };
  } else {
    const { data: realCart } = await supabase
      .from("carts")
      .select("id, vendor_id")
      .eq("customer_id", session.userId)
      .eq("status", "open")
      .maybeSingle();

    cart = realCart;

    if (!cart || !cart.vendor_id) {
      return <EmptyCart />;
    }

    const [{ data: realVendor }, { data: realItems }] = await Promise.all([
      supabase
        .from("vendors")
        .select("id, name")
        .eq("id", cart.vendor_id)
        .single(),
      supabase
        .from("cart_items")
        .select(
          "id, menu_item_id, name_snapshot, unit_price_kobo, qty, options_snapshot, line_total_kobo",
        )
        .eq("cart_id", cart.id),
    ]);

    vendor = realVendor;
    items = realItems ?? [];
  }

  if (!cart || !items.length) {
    return <EmptyCart />;
  }

  return (
    <>
      {/* Desktop - rendered but hidden on mobile */}
      <div className="hidden md:block">
        <CartDesktop items={items} vendor={vendor!} />
      </div>

      {/* Mobile - rendered but hidden on desktop */}
      <div className="md:hidden">
        <CartMobile items={items} vendor={vendor!} />
      </div>
    </>
  );
}

function EmptyCart() {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">Your Cart</h1>
      <div className="mt-4">
        <EmptyState
          title="Your cart is empty"
          description="Browse vendors and add something to eat."
          action={
            <Link
              href="/home"
              className={buttonVariants({ variant: "primary" })}
            >
              Browse vendors
            </Link>
          }
        />
      </div>
    </div>
  );
}
