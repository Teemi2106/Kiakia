// app/(customer)/checkout/page.tsx
import { formatNaira, koboOf } from "@kiakia/domain";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { CheckoutForm } from "./_components/CheckoutForm";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const session = await verifySession();
  const supabase = await createClient();

  const { data: cart } = await supabase
    .from("carts")
    .select("id, vendor_id")
    .eq("customer_id", session.userId)
    .eq("status", "open")
    .maybeSingle();

  if (!cart || !cart.vendor_id) {
    redirect("/cart");
  }

  const [{ data: vendor }, { data: items }, { data: addresses }] =
    await Promise.all([
      supabase
        .from("vendors")
        .select("name, min_order_kobo")
        .eq("id", cart.vendor_id)
        .single(),
      supabase
        .from("cart_items")
        .select("id, name_snapshot, qty, line_total_kobo")
        .eq("cart_id", cart.id),
      supabase
        .from("addresses")
        .select("id, label, line1, landmark, city, state, is_default")
        .eq("customer_id", session.userId)
        .order("is_default", { ascending: false }),
    ]);

  const subtotalKobo = (items ?? []).reduce(
    (sum, item) => sum + item.line_total_kobo,
    0,
  );

  if (!items || items.length === 0) {
    redirect("/cart");
  }

  // Get the default address or first one
  const defaultAddress =
    addresses?.find((a) => a.is_default) ?? addresses?.[0] ?? null;

  return (
    <CheckoutForm
      vendor={vendor}
      items={items}
      addresses={addresses ?? []}
      defaultAddress={defaultAddress}
      subtotalKobo={subtotalKobo}
    />
  );
}
