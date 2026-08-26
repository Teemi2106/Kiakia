// app/(customer)/orders/[id]/tracking/page.tsx
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import type { OrderStatus } from "@kiakia/domain";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrackingDesktop } from "./_components/TrackingDesktop";
import { TrackingMobile } from "./_components/TrackingMobile";
import { isTrackingTerminal } from "./_components/statusCopy";
import type { TimelineStep, Driver, Vendor } from "./_components/types";

export const metadata: Metadata = { title: "Live Tracking" };

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

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, code, status, vendor_id, rider_id, placed_at, accepted_at, ready_at, assigned_at, picked_up_at, in_transit_at, arrived_at, delivered_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!order) notFound();

  // delivery_code lives in its own table now (order_delivery_codes,
  // supabase/migrations/0022_delivery_code_off_orders.sql), RLS-scoped to
  // this order's own customer only — never the assigned rider or vendor
  // staff, even though both can otherwise read this order row via
  // 0007_rls.sql's own policies. For a non-customer session this query
  // naturally returns no row.
  const { data: deliveryCodeRow } = await supabase
    .from("order_delivery_codes")
    .select("code")
    .eq("order_id", order.id)
    .maybeSingle();

  const [{ data: vendorRow }, { count: itemCount }, riderRows] = await Promise.all([
    supabase.from("vendors").select("name").eq("id", order.vendor_id).maybeSingle(),
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

  const status = order.status as OrderStatus;
  const steps = buildSteps({ ...order, status });

  const vendor: Vendor = {
    name: vendorRow?.name ?? "Vendor",
    itemCount: itemCount ?? 0,
  };

  // rider_id is a real FK, but no Server Action in this app assigns one yet
  // (dispatch is Phase 3 — see supabase/migrations/0002_identity.sql), so
  // this will realistically always resolve to undefined today. When it is
  // set, only the fields the `riders`/`profiles` tables actually carry are
  // shown — no rating, no live location.
  let driver: Driver | undefined;
  if (riderRows) {
    const [{ data: rider }, { data: riderProfile }] = riderRows;
    if (rider || riderProfile) {
      driver = {
        name: riderProfile?.full_name ?? "Rider",
        car: rider?.vehicle_type ?? undefined,
        plateNumber: rider?.plate_number ?? undefined,
      };
    }
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
      <div className="hidden pt-6 lg:block">
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
