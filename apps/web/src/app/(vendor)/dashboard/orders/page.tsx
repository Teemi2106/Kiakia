import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatNaira, koboOf } from "@kiakia/domain";
import { Card, EmptyState, OrderStatusBadge } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VendorOrderActions } from "../../_components/VendorOrderActions";

export const metadata: Metadata = { title: "Orders" };

const ACTIVE_STATUSES = [
  "placed",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "rider_assigned",
  "picked_up",
  "in_transit",
  "arrived",
] as const;

export default async function VendorOrdersPage() {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("orders")
    .select("id, code, status, total_kobo, created_at")
    .eq("vendor_id", vendor.id)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">Active Orders</h1>

      {!orders || orders.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No active orders" description="New orders will show up here as customers place them." />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {orders.map((order) => (
            <Card key={order.id}>
              <Link href={`/dashboard/orders/${order.id}`} className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-ink">{order.code}</p>
                  <p className="text-sm text-ink-muted">{formatNaira(koboOf(order.total_kobo))}</p>
                  <p className="text-xs text-ink-muted">{new Date(order.created_at).toLocaleTimeString("en-NG")}</p>
                </div>
                <OrderStatusBadge status={order.status} />
              </Link>
              <div className="mt-3">
                <VendorOrderActions orderId={order.id} status={order.status} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
