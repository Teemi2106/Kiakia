import { formatNaira, koboOf } from "@kiakia/domain";
import { Card, EmptyState, OrderStatusBadge, buttonVariants } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Orders" };

// Active = not yet in a terminal state. packages/domain's isTerminalStatus
// is the spec for this; the SQL `not in (...)` list below is its mirror,
// same discipline as order-state-machine.ts <-> transition_order().
const TERMINAL_STATUSES = [
  "delivered",
  "rejected_by_vendor",
  "failed_delivery",
  "cancelled_by_customer",
  "cancelled_by_platform",
] as const;

export default async function ActiveOrdersPage() {
  const session = await verifySession();
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("id, code, status, total_kobo, vendor_id, created_at")
    .eq("customer_id", session.userId)
    .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
    .order("created_at", { ascending: false });

  const vendorIds = [...new Set((orders ?? []).map((o) => o.vendor_id))];
  const { data: vendors } = vendorIds.length
    ? await supabase.from("vendors").select("id, name").in("id", vendorIds)
    : { data: [] };
  const vendorName = (id: string) => vendors?.find((v) => v.id === id)?.name ?? "Vendor";

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">Active Orders</h1>

      {!orders || orders.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No active orders"
            description="Track your incoming meals here once you place an order."
            action={
              <Link href="/home" className={buttonVariants({ variant: "primary" })}>
                Browse vendors
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {orders.map((order) => (
            <Link key={order.id} href={`/orders/${order.id}`}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink">{vendorName(order.vendor_id)}</p>
                    <p className="text-xs text-ink-muted">{order.code}</p>
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
