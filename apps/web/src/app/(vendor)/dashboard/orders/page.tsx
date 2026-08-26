// app/(vendor)/orders/page.tsx
import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrdersWrapper } from "./_components/OrdersWrapper";
import { EmptyState } from "@kiakia/ui";

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

  const { data: realOrders } = await supabase
    .from("orders")
    .select("id, code, status, total_kobo, created_at")
    .eq("vendor_id", vendor.id)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: true });
  const orders = realOrders || [];

  if (orders.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <h1 className="text-xl font-semibold text-ink">Active Orders</h1>
        <div className="mt-4">
          <EmptyState
            title="No active orders"
            description="New orders will show up here as customers place them."
          />
        </div>
      </div>
    );
  }

  return <OrdersWrapper orders={orders} />;
}
