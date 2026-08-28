// app/(customer)/orders/history/page.tsx
import { EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { OrderHistoryDesktop } from "./_components/OrderHistoryDesktop";
import { OrderHistoryMobile } from "./_components/OrderHistoryMobile";

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

  const { data: realOrders } = await supabase
    .from("orders")
    .select("id, code, status, total_kobo, vendor_id, created_at")
    .eq("customer_id", session.userId)
    .in("status", TERMINAL_STATUSES)
    .order("created_at", { ascending: false })
    .limit(50);

  const orders = realOrders ?? [];
  const orderIds = orders.map((o) => o.id);
  const vendorIds = [...new Set(orders.map((o) => o.vendor_id))];

  const [{ data: realVendors }, { data: itemRows }] = await Promise.all([
    vendorIds.length
      ? supabase.from("vendors").select("id, name, logo_url").in("id", vendorIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabase.from("order_items").select("order_id").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
  ]);
  const vendors = realVendors ?? [];

  const itemCountByOrderId = new Map<string, number>();
  for (const row of itemRows ?? []) {
    itemCountByOrderId.set(row.order_id, (itemCountByOrderId.get(row.order_id) ?? 0) + 1);
  }

  if (orders.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <h1 className="text-xl font-semibold text-ink">Order History</h1>
        <div className="mt-4">
          <EmptyState
            title="No past orders yet"
            description="Your completed and cancelled orders will show up here."
          />
        </div>
      </div>
    );
  }

  const ordersWithItemCount = orders.map((order) => ({
    ...order,
    item_count: itemCountByOrderId.get(order.id) ?? 0,
  }));

  return (
    <>
      <div className="hidden lg:block">
        <OrderHistoryDesktop orders={ordersWithItemCount} vendors={vendors} />
      </div>
      <div className="lg:hidden">
        <OrderHistoryMobile orders={ordersWithItemCount} vendors={vendors} />
      </div>
    </>
  );
}
