// app/(vendor)/history/page.tsx
import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatNaira, koboOf } from "@kiakia/domain";
import { Card, EmptyState, OrderStatusBadge } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HistoryDesktop } from "./_components/HistoryDesktop";
import { HistoryMobile } from "./_components/HistoryMobile";

export const metadata: Metadata = { title: "Order History" };

const TERMINAL_STATUSES = [
  "delivered",
  "rejected_by_vendor",
  "failed_delivery",
  "cancelled_by_customer",
  "cancelled_by_platform",
] as const;

// Demo data
const DEMO_ORDERS = [
  {
    id: "order-1",
    code: "KK-89423",
    status: "delivered",
    total_kobo: 1240000,
    created_at: new Date().toISOString(),
    customer_name: "Adebayo Chinedu",
    items: "2x Jollof Rice (Party style)",
  },
  {
    id: "order-2",
    code: "KK-89419",
    status: "cancelled_by_customer",
    total_kobo: 850000,
    created_at: new Date(Date.now() - 86400000).toISOString(),
    customer_name: "Sarah Johnson",
    items: "1x Grilled Croaker, Fried Yam",
  },
  {
    id: "order-3",
    code: "KK-89401",
    status: "rejected_by_vendor",
    total_kobo: 1820000,
    created_at: new Date(Date.now() - 172800000).toISOString(),
    customer_name: "Ibrahim Musa",
    items: "4x Goat Meat Pepper Soup",
  },
  {
    id: "order-4",
    code: "KK-89398",
    status: "delivered",
    total_kobo: 500000,
    created_at: new Date(Date.now() - 259200000).toISOString(),
    customer_name: "Emeka Okafor",
    items: "1x Egusi Soup & Pounded Yam",
  },
];

export default async function VendorHistoryPage() {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  const supabase = await createClient();

  // Use demo data for development
  const useDummyData = true;
  let orders = [];

  if (useDummyData) {
    orders = DEMO_ORDERS;
  } else {
    const { data: realOrders } = await supabase
      .from("orders")
      .select("id, code, status, total_kobo, created_at")
      .eq("vendor_id", vendor.id)
      .in("status", TERMINAL_STATUSES)
      .order("created_at", { ascending: false })
      .limit(100);
    orders = realOrders || [];
  }

  const fulfilled = orders.filter((o) => o.status === "delivered").length;
  const cancelled = orders.filter(
    (o) =>
      o.status === "cancelled_by_customer" ||
      o.status === "cancelled_by_platform",
  ).length;
  const disputed = orders.filter(
    (o) => o.status === "rejected_by_vendor",
  ).length;

  if (orders.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <h1 className="text-xl font-semibold text-ink">Order History</h1>
        <div className="mt-6">
          <EmptyState title="No past orders yet" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="hidden lg:block">
        <HistoryDesktop
          orders={orders}
          fulfilled={fulfilled}
          cancelled={cancelled}
          disputed={disputed}
        />
      </div>
      <div className="lg:hidden">
        <HistoryMobile
          orders={orders}
          fulfilled={fulfilled}
          cancelled={cancelled}
          disputed={disputed}
        />
      </div>
    </>
  );
}
