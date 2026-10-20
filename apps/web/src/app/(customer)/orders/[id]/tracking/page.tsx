// app/(customer)/orders/[id]/tracking/page.tsx
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@kiakia/db";
import type { OrderStatus } from "@kiakia/domain";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TrackingDesktop } from "./_components/TrackingDesktop";
import { TrackingMobile } from "./_components/TrackingMobile";
import { isTrackingTerminal } from "./_components/statusCopy";
import type { TimelineStep, Driver, Vendor } from "./_components/types";

export const metadata: Metadata = { title: "Live Tracking" };

// postgrest-js's `.single()` narrows via `Result extends (infer R)[] ? R :
// never` — but generated.ts models get_order_tracking's Returns as a plain
// object rather than a `[]` + SetofOptions, so the chain types as `never`.
// Same cast-back-to-the-function's-own-Returns-type fix as
// useOrderTracking.ts's own identical comment for this same function.
type GetOrderTrackingRow = Database["public"]["Functions"]["get_order_tracking"]["Returns"];

interface TrackingPageProps {
  params: Promise<{ id: string }>;
}

function formatTime(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface OrderTimestamps {
  status: OrderStatus;
  placed_at: string | null;
  accepted_at: string | null;
  ready_at: string | null;
  assigned_at: string | null;
  picked_up_at: string | null;
  in_transit_at: string | null;
  arrived_at: string | null;
  delivered_at: string | null;
}

/**
 * Builds the timeline entirely from the order's own timestamp columns
 * (stamped by transition_order() — supabase/migrations/0006_transition_order.sql).
 * No step time or "in progress" marker is invented beyond what's actually
 * recorded.
 */
function buildSteps(order: OrderTimestamps): TimelineStep[] {
  const stops: Array<{ id: string; label: string; at: string | null }> = [
    { id: "placed", label: "Order Confirmed", at: order.placed_at },
    { id: "accepted", label: "Order Accepted", at: order.accepted_at },
    { id: "ready", label: "Ready for Pickup", at: order.ready_at },
    { id: "assigned", label: "Rider Assigned", at: order.assigned_at },
    { id: "picked_up", label: "Picked Up", at: order.picked_up_at },
    { id: "in_transit", label: "Rider on the way", at: order.in_transit_at },
    { id: "delivered", label: "Delivered", at: order.delivered_at },
  ];

  const terminal = isTrackingTerminal(order.status);
  let activeAssigned = false;

  return stops.map((stop): TimelineStep => {
    if (stop.at) {
      return { id: stop.id, label: stop.label, time: formatTime(stop.at), status: "done" };
    }
    if (!terminal && !activeAssigned) {
      activeAssigned = true;
      return { id: stop.id, label: stop.label, time: "In progress", status: "active" };
    }
    return { id: stop.id, label: stop.label, time: "", status: "pending" };
  });
}

export default async function TrackingPage({ params }: TrackingPageProps) {
  await verifySession();
  const { id } = await params;
  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, code, status, vendor_id, rider_id, placed_at, accepted_at, ready_at, assigned_at, picked_up_at, in_transit_at, arrived_at, delivered_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (orderError) {
    console.error("[tracking_page] order query failed", id, orderError);
  }

  if (!order) notFound();

  // A "draft" order is one place_order() created but payment never captured
  // for - the customer cancelled checkout, or abandoned it before finishing.
  // It never became a real order, so there is nothing here to track live:
  // no vendor is preparing it, no rider will ever be offered it. Send the
  // customer to its detail page instead, which already renders the correct
  // "payment wasn't completed" state with a retry action - see
  // orders/[id]/page.tsx's own `needsPayment` check, which this mirrors.
  if (order.status === "draft") {
    redirect(`/orders/${order.id}`);
  }

  // delivery_code lives in its own table now (order_delivery_codes,
  // supabase/migrations/0022_delivery_code_off_orders.sql), RLS-scoped to
  // this order's own customer only — never the assigned rider or vendor
  // staff, even though both can otherwise read this order row via
  // 0007_rls.sql's own policies. For a non-customer session this query
  // naturally returns no row. It is read in the same wave as the rest, not
  // after them: nothing here depends on another result.
  const [{ data: vendorRow }, { count: itemCount }, { data: rawTrackingRow }, { data: deliveryCodeRow }] = await Promise.all([
    supabase
      .from("vendors")
      .select("name, logo_url")
      .eq("id", order.vendor_id)
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("order_id", order.id),
    // get_order_tracking() (0029, extended by 0071 with rider contact info)
    // is the only way this read can ever see the assigned rider's name/
    // phone/vehicle at all: `profiles` and `riders` are both own-row-only
    // under RLS (0007_rls.sql), so a direct query for another user's row —
    // exactly what fetching "the rider assigned to MY order" is — silently
    // returns nothing no matter how it's written. This function is
    // SECURITY DEFINER with its own explicit "customer of this order, or
    // this vendor's staff, or admin" check in place of relying on RLS at
    // all. See 0071's own header for how this went unnoticed until now:
    // the broken direct query never errored, it just always returned an
    // empty driver card.
    order.rider_id
      ? supabase.rpc("get_order_tracking", { p_order_id: order.id }).single()
      : Promise.resolve({ data: null }),
    supabase.from("order_delivery_codes").select("code").eq("order_id", order.id).maybeSingle(),
  ]);

  const status = order.status as OrderStatus;
  const steps = buildSteps({ ...order, status });

  const vendor: Vendor = {
    name: vendorRow?.name ?? "Vendor",
    itemCount: itemCount ?? 0,
    logoUrl: vendorRow?.logo_url ?? undefined,
  };

  const trackingRow = rawTrackingRow as GetOrderTrackingRow | null;

  // Only the fields riders/profiles actually carry are shown — no rating,
  // no fabricated placeholder when a field is genuinely unset.
  let driver: Driver | undefined;
  if (trackingRow && (trackingRow.rider_name || trackingRow.rider_phone)) {
    driver = {
      name: trackingRow.rider_name ?? "Rider",
      phone: trackingRow.rider_phone ?? undefined,
      car: trackingRow.rider_vehicle_type ?? undefined,
      plateNumber: trackingRow.rider_plate_number ?? undefined,
    };
  }

  // The rider needs this read out to them to confirm delivery
  // (verify_delivery_and_release_escrow) — surfaced from the moment the
  // order is actually en route, not only after it's already been marked
  // delivered (the /delivered page already shows it post-hoc). Matches the
  // delivered page's own "omit rather than fabricate" convention: no code,
  // no section.
  const showDeliveryCode = status === "in_transit" || status === "arrived";
  const deliveryCode = showDeliveryCode ? (deliveryCodeRow?.code ?? undefined) : undefined;

  return (
    <>
      <div className="hidden lg:block">
        <TrackingDesktop
          steps={steps}
          driver={driver}
          vendor={vendor}
          orderId={id}
          orderCode={order.code}
          status={status}
          deliveryCode={deliveryCode}
        />
      </div>
      <div className="lg:hidden">
        <TrackingMobile
          steps={steps}
          driver={driver}
          vendor={vendor}
          orderId={id}
          orderCode={order.code}
          status={status}
          deliveryCode={deliveryCode}
        />
      </div>
    </>
  );
}
