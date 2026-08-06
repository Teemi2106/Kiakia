import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatNaira, koboOf } from "@kiakia/domain";
import { Card, EmptyState, OrderStatusBadge } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Order History" };

const TERMINAL_STATUSES = [
  "delivered",
  "rejected_by_vendor",
  "failed_delivery",
  "cancelled_by_customer",
  "cancelled_by_platform",
] as const;

export default async function VendorHistoryPage() {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("orders")
    .select("id, code, status, total_kobo, created_at")
    .eq("vendor_id", vendor.id)
    .in("status", TERMINAL_STATUSES)
    .order("created_at", { ascending: false })
    .limit(100);

  const fulfilled = (orders ?? []).filter((o) => o.status === "delivered").length;
  const cancelled = (orders ?? []).length - fulfilled;

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">Order History</h1>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Card>
          <p className="text-2xl font-semibold text-positive">{fulfilled}</p>
          <p className="text-xs text-ink-muted">Fulfilled</p>
        </Card>
        <Card>
          <p className="text-2xl font-semibold text-danger">{cancelled}</p>
          <p className="text-xs text-ink-muted">Cancelled / Rejected</p>
        </Card>
      </div>

      {!orders || orders.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No past orders yet" />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {orders.map((order) => (
            <Link key={order.id} href={`/dashboard/orders/${order.id}`}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink">{order.code}</p>
                    <p className="text-xs text-ink-muted">{new Date(order.created_at).toLocaleDateString("en-NG")}</p>
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
