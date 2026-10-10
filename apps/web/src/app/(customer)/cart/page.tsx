// app/(customer)/cart/page.tsx
import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { CartPageView } from "./_components/CartPageView";

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
    return <CartPageView items={[]} vendor={null} />;
  }

  const [{ data: vendor }, { data: items }] = await Promise.all([
    supabase.from("vendors").select("id, name").eq("id", cart.vendor_id).single(),
    supabase
      .from("cart_items")
      .select("id, menu_item_id, name_snapshot, unit_price_kobo, qty, options_snapshot, line_total_kobo")
      .eq("cart_id", cart.id),
  ]);

  // A separate query rather than a PostgREST embed — see CartDrawer.tsx's
  // fetchCartData() for why (no embed precedent anywhere in this app, and
  // packages/db's hand-maintained generated.ts has no Relationships
  // metadata for the client library to type one against).
  const menuItemIds = [...new Set((items ?? []).map((item) => item.menu_item_id))];
  const { data: menuItemRows } = menuItemIds.length
    ? await supabase.from("menu_items").select("id, image_url").in("id", menuItemIds)
    : { data: [] };
  const imageByMenuItemId = new Map((menuItemRows ?? []).map((row) => [row.id, row.image_url]));

  const itemsWithImages = (items ?? []).map((item) => ({
    ...item,
    menu_item_image_url: item.menu_item_id ? (imageByMenuItemId.get(item.menu_item_id) ?? null) : null,
  }));

  return <CartPageView items={itemsWithImages} vendor={vendor ?? null} />;
}
