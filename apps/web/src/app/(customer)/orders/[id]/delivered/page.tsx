// app/(customer)/orders/[id]/delivered/page.tsx
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, buttonVariants } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeliveredDesktop } from "./_components/DeliveredDesktop";
import { DeliveredMobile } from "./_components/DeliveredMobile";
import type { Driver } from "./_components/types";

export const metadata: Metadata = { title: "Order Delivered" };

interface DeliveredPageProps {
  params: Promise<{ id: string }>;
}

export default async function DeliveredPage({ params }: DeliveredPageProps) {
  await verifySession();
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, code, status, vendor_id, rider_id")
    .eq("id", id)
    .maybeSingle();

  if (!order) notFound();

  // delivery_code lives in its own table now (order_delivery_codes,
  // supabase/migrations/0022_delivery_code_off_orders.sql), RLS-scoped to
  // this order's own customer only — never the assigned rider or vendor
  // staff. For a non-customer session this query naturally returns no row.
  const { data: deliveryCodeRow } = await supabase
    .from("order_delivery_codes")
    .select("code")
    .eq("order_id", order.id)
    .maybeSingle();

  // Honest fallback: this screen only makes sense once the order has
  // actually reached `delivered` (written only by transition_order() —
  // supabase/migrations/0006_transition_order.sql). It's linked to from the
  // tracking page's "Track Delivery" button before that happens too, so we
  // don't fabricate a "Delivered!" screen for an order that isn't.
  if (order.status !== "delivered") {
    return (
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <EmptyState
          title="Not delivered yet"
          description="This order hasn't been marked as delivered yet. You can keep an eye on it from the live tracking page."
          action={
            <Link
              href={`/orders/${id}/tracking`}
              className={buttonVariants({ variant: "primary" })}
            >
              Back to tracking
            </Link>
          }
        />
      </div>
    );
  }

  const [{ count: itemCount }, riderRows] = await Promise.all([
    supabase
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("order_id", order.id),
    order.rider_id
      ? Promise.all([
          supabase
            .from("riders")
            .select("vehicle_type, plate_number")
            .eq("user_id", order.rider_id)
            .maybeSingle(),
          supabase.from("profiles").select("full_name").eq("id", order.rider_id).maybeSingle(),
        ])
      : Promise.resolve(null),
  ]);

  // rider_id is a real FK, but no Server Action in this app assigns one yet
  // (dispatch is Phase 3 — see supabase/migrations/0002_identity.sql), so
  // this will realistically always resolve to undefined today. When it is
  // set, only the fields the `riders`/`profiles` tables actually carry are
  // shown — no fabricated avatar.
  let driver: Driver | undefined;
  if (riderRows) {
    const [{ data: rider }, { data: riderProfile }] = riderRows;
    if (rider || riderProfile) {
      driver = {
        name: riderProfile?.full_name ?? "Rider",
        vehicle: rider?.vehicle_type ?? undefined,
        plateNumber: rider?.plate_number ?? undefined,
      };
    }
  }

  return (
    <>
      <div className="hidden md:block">
        <DeliveredDesktop
          driver={driver}
          deliveryCode={deliveryCodeRow?.code ?? undefined}
          itemCount={itemCount ?? 0}
        />
      </div>
      <div className="md:hidden">
        <DeliveredMobile
          driver={driver}
          deliveryCode={deliveryCodeRow?.code ?? undefined}
        />
      </div>
    </>
  );
}
