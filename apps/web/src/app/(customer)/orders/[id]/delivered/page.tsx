// app/(customer)/orders/[id]/delivered/page.tsx
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@kiakia/db";
import { EmptyState, buttonVariants } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeliveredDesktop } from "./_components/DeliveredDesktop";
import { DeliveredMobile } from "./_components/DeliveredMobile";
import { RateOrderPopup } from "./_components/RateOrderPopup";
import type { Driver } from "./_components/types";

// Same postgrest-js `.single()` narrowing fix as the tracking page and the
// vendor order detail page's own identical comments for this function.
type GetOrderTrackingRow = Database["public"]["Functions"]["get_order_tracking"]["Returns"];

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

  const [{ count: itemCount }, { data: vendorRow }, { data: rawTrackingRow }, { data: existingRating }] =
    await Promise.all([
      supabase
        .from("order_items")
        .select("id", { count: "exact", head: true })
        .eq("order_id", order.id),
      supabase.from("vendors").select("name").eq("id", order.vendor_id).maybeSingle(),
      // get_order_tracking() (0029, extended by 0071 for rider contact
      // info) is the only way this read can ever see the assigned rider's
      // name/vehicle at all: `profiles`/`riders` are both own-row-only
      // under RLS (0007_rls.sql), so the direct query this page used to
      // run here always silently returned nothing - see 0071's own header.
      order.rider_id
        ? supabase.rpc("get_order_tracking", { p_order_id: order.id }).single()
        : Promise.resolve({ data: null }),
      // "customer reads own order ratings" (0073_order_ratings.sql) - null
      // means this order hasn't been rated yet, which is the common case
      // the popup below exists for.
      supabase.from("order_ratings").select("order_id").eq("order_id", order.id).maybeSingle(),
    ]);

  const trackingRow = rawTrackingRow as GetOrderTrackingRow | null;

  // Only the fields riders/profiles actually carry are shown — no
  // fabricated avatar, no rating (that's what this page's own popup below
  // is for).
  let driver: Driver | undefined;
  if (trackingRow?.rider_name) {
    driver = {
      name: trackingRow.rider_name,
      vehicle: trackingRow.rider_vehicle_type ?? undefined,
      plateNumber: trackingRow.rider_plate_number ?? undefined,
    };
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
      {!existingRating && (
        <RateOrderPopup
          orderId={order.id}
          vendorName={vendorRow?.name ?? "the vendor"}
          riderId={order.rider_id}
          riderName={trackingRow?.rider_name ?? null}
        />
      )}
    </>
  );
}
