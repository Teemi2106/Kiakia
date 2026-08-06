import { formatNaira, koboOf } from "@kiakia/domain";
import { Card, EmptyState, OrderStatusBadge } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Order History" };

const TERMINAL_STATUSES = [
  "delivered",
  "rejected_by_vendor",
  "failed_delivery",
  "cancelled_by_customer",
  "cancelled_by_platform",
] as const;

export default async function OrderHistoryPage() {
  const session = await verifySession();
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("id, code, status, total_kobo, vendor_id, created_at")
    .eq("customer_id", session.userId)
    .in("status", TERMINAL_STATUSES)
    .order("created_at", { ascending: false })
    .limit(50);

  const vendorIds = [...new Set((orders ?? []).map((o) => o.vendor_id))];
  const { data: vendors } = vendorIds.length
    ? await supabase.from("vendors").select("id, name").in("id", vendorIds)
    : { data: [] };
  const vendorName = (id: string) => vendors?.find((v) => v.id === id)?.name ?? "Vendor";

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">Order History</h1>

      {!orders || orders.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No past orders yet" description="Your completed and cancelled orders will show up here." />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {orders.map((order) => (
            <Link key={order.id} href={`/orders/${order.id}`}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink">{vendorName(order.vendor_id)}</p>
                    <p className="text-xs text-ink-muted">
                      {order.code} · {new Date(order.created_at).toLocaleDateString("en-NG")}
                    </p>
                  </div>
                  <OrderStatusBadge status={order.status} />
                </div>
                <p className="mt-2 text-sm font-medium text-ink">{formatNaira(koboOf(order.total_kobo))}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
