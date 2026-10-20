// app/(customer)/checkout/page.tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";
import { getCustomerBootstrap } from "@/lib/customer/bootstrap";
import { createClient } from "@/lib/supabase/server";
import { CheckoutForm } from "./_components/CheckoutForm";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const session = await verifySession();
  const supabase = await createClient();

  // The open cart and its lines come from the layout's cached bootstrap
  // (the same read that seeds the client store), so checkout opens no cart
  // queries of its own. place_order() re-derives every price from the DB, so
  // these lines are for display and the subtotal estimate only.
  const { cart, lines } = await getCustomerBootstrap(session.userId);

  if (!cart || lines.length === 0) {
    redirect("/cart");
  }

  const items = lines.map(({ id, name_snapshot, qty, line_total_kobo }) => ({ id, name_snapshot, qty, line_total_kobo }));

  // get_wallet_balance() (0045_customer_wallet.sql) answers only for
  // auth.uid() and takes no arguments, so there is nothing to scope here.
  // A failed read is a zero balance, not a broken checkout — the wallet
  // option simply doesn't appear, and card checkout is unaffected.
  const [{ data: vendor }, { data: addresses }, { data: profile }, { data: walletBalanceKobo }] =
    await Promise.all([
      supabase
        .from("vendors")
        .select("name, min_order_kobo, location_lat, location_lng")
        .eq("id", cart.vendorId)
        .single(),
      supabase
        .from("addresses")
        .select(
          "id, label, line1, landmark, city, state, is_default, location_lat, location_lng",
        )
        .eq("customer_id", session.userId)
        .order("is_default", { ascending: false }),
      // "read own profile" (0007_rls.sql) permits this — session.userId IS
      // auth.uid() here, unlike the cross-user rider/customer lookups
      // 0071_order_tracking_rider_contact.sql had to route around RLS for.
      supabase.from("profiles").select("phone").eq("id", session.userId).maybeSingle(),
      supabase.rpc("get_wallet_balance"),
    ]);

  const subtotalKobo = items.reduce((sum, item) => sum + item.line_total_kobo, 0);

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
      walletBalanceKobo={walletBalanceKobo ?? 0}
      customerPhone={profile?.phone ?? null}
    />
  );
}
