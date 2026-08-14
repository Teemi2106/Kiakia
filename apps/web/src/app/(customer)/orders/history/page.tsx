// app/(customer)/orders/history/page.tsx
import { formatNaira, koboOf } from "@kiakia/domain";
import { Card, EmptyState, OrderStatusBadge } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
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

// Dummy data for testing
const DUMMY_ORDERS = [
  {
    id: "order-1",
    code: "ORD-2024-001",
    status: "delivered",
    total_kobo: 1250000,
    vendor_id: "vendor-1",
    created_at: new Date().toISOString(),
  },
  {
    id: "order-2",
    code: "ORD-2024-002",
    status: "cancelled_by_customer",
    total_kobo: 850000,
    vendor_id: "vendor-2",
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: "order-3",
    code: "ORD-2024-003",
    status: "delivered",
    total_kobo: 750000,
    vendor_id: "vendor-3",
    created_at: new Date(Date.now() - 172800000).toISOString(),
  },
];

const DUMMY_VENDORS = [
  { id: "vendor-1", name: "Mama Cass" },
  { id: "vendor-2", name: "Iya Basira" },
  { id: "vendor-3", name: "Tunde's Kitchen" },
];

export default async function OrderHistoryPage() {
  const session = await verifySession();
  const supabase = await createClient();

  const useDummyData = true; // Set to false for real data

  let orders = null;
  let vendors = [];

  if (useDummyData) {
    orders = DUMMY_ORDERS;
    vendors = DUMMY_VENDORS;
  } else {
    const { data: realOrders } = await supabase
      .from("orders")
      .select("id, code, status, total_kobo, vendor_id, created_at")
      .eq("customer_id", session.userId)
      .in("status", TERMINAL_STATUSES)
      .order("created_at", { ascending: false })
      .limit(50);

    orders = realOrders;

    const vendorIds = [...new Set((orders ?? []).map((o) => o.vendor_id))];
    const { data: realVendors } = vendorIds.length
      ? await supabase.from("vendors").select("id, name").in("id", vendorIds)
      : { data: [] };
    vendors = realVendors ?? [];
  }

  const vendorName = (id: string) =>
    vendors?.find((v) => v.id === id)?.name ?? "Vendor";

  if (!orders || orders.length === 0) {
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

  return (
    <>
      <div className="hidden lg:block">
        <OrderHistoryDesktop orders={orders} vendors={vendors} />
      </div>
      <div className="lg:hidden">
        <OrderHistoryMobile orders={orders} vendors={vendors} />
      </div>
    </>
  );
}
