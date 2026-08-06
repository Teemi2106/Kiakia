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

  const [{ data: vendor }, { data: items }, { data: addresses }] = await Promise.all([
    supabase.from("vendors").select("name, min_order_kobo").eq("id", cart.vendor_id).single(),
    supabase.from("cart_items").select("id, name_snapshot, qty, line_total_kobo").eq("cart_id", cart.id),
    supabase
      .from("addresses")
      .select("id, label, line1, landmark, city, state, is_default")
      .eq("customer_id", session.userId)
      .order("is_default", { ascending: false }),
  ]);

  const subtotalKobo = (items ?? []).reduce((sum, item) => sum + item.line_total_kobo, 0);

  if (!items || items.length === 0) {
    redirect("/cart");
  }

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">Checkout</h1>
      {vendor && <p className="mt-1 text-sm text-ink-muted">from {vendor.name}</p>}

      <div className="mt-4 rounded-card border border-border bg-surface-raised p-4">
        <h2 className="text-sm font-semibold text-ink">Order Summary</h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-muted">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between">
              <span>
                {item.qty}× {item.name_snapshot}
              </span>
              <span>{formatNaira(koboOf(item.line_total_kobo))}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-border pt-3 text-sm font-semibold text-ink">
          <span>Subtotal</span>
          <span>{formatNaira(koboOf(subtotalKobo))}</span>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          Delivery and service fees are calculated from your delivery address on the next step.
        </p>
      </div>

      <CheckoutForm addresses={addresses ?? []} />
    </div>
  );
}
