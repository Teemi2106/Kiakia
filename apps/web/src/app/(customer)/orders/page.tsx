// app/(customer)/orders/page.tsx
import { EmptyState, buttonVariants } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { OrdersList } from "./_components/OrdersList";

export const metadata: Metadata = { title: "Orders" };

const TERMINAL_STATUSES = [
  "delivered",
  "rejected_by_vendor",
  "failed_delivery",
  "cancelled_by_customer",
  "cancelled_by_platform",
] as const;

// Dummy data for development
const DUMMY_ORDERS = [
  {
    id: "order-1",
    code: "ORD-2024-001",
    status: "preparing",
    total_kobo: 1250000,
    vendor_id: "vendor-1",
    created_at: new Date().toISOString(),
    items: [
      { name: "Special Jollof Rice Combo", qty: 1 },
      { name: "Extra Plantain", qty: 1 },
      { name: "Chilled Malt Drink", qty: 1 },
    ],
  },
  {
    id: "order-2",
    code: "ORD-2024-002",
    status: "in_transit",
    total_kobo: 850000,
    vendor_id: "vendor-2",
    created_at: new Date(Date.now() - 3600000).toISOString(),
    Location: "Ikeja, Lagos",
    items: [
      { name: "Spicy Suya Portions (Beef)", qty: 2 },
      { name: "Roasted Yam slices", qty: 1 },
      { name: "Extra Onions", qty: 1 },
    ],
  },
  {
    id: "order-3",
    code: "ORD-2024-003",
    status: "in_transit",
    total_kobo: 1250000,
    vendor_id: "vendor-1",
    created_at: new Date().toISOString(),
    Location: "Ikeja, Lagos",
    items: [
      { name: "Special Jollof Rice Combo", qty: 1 },
      { name: "Extra Plantain", qty: 1 },
      { name: "Chilled Malt Drink", qty: 1 },
    ],
  },
  {
    id: "order-4",
    code: "ORD-2024-004",
    status: "preparing",
    total_kobo: 150000,
    vendor_id: "vendor-2",
    created_at: new Date().toISOString(),
    items: [
      { name: "Special White Rice Combo", qty: 1 },
      { name: "Extra beans", qty: 1 },
      { name: "Chilled coke Drink", qty: 1 },
    ],
  },
];

const DUMMY_VENDORS = [
  { id: "vendor-1", name: "Mama Cass", profile_image_url: null },
  { id: "vendor-2", name: "Iya Basira", profile_image_url: null },
];

export default async function ActiveOrdersPage() {
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
      .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
      .order("created_at", { ascending: false });

    orders = realOrders;

    const vendorIds = [...new Set((orders ?? []).map((o) => o.vendor_id))];
    const { data: realVendors } = vendorIds.length
      ? await supabase.from("vendors").select("id, name").in("id", vendorIds)
      : { data: [] };
    vendors = realVendors ?? [];
  }

  const vendorName = (id: string) =>
    vendors?.find((v) => v.id === id)?.name ?? "Vendor";

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-12">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-sora text-[28px] font-bold text-[#1C1B1B] pt-6 sm:text-[48px] sm:leading-[56px] sm:tracking-[-0.96px]">
          Active Orders
        </h1>
        <p className="mt-2 font-inter text-base text-[#5B403C] sm:text-[18px] sm:leading-7">
          Track your incoming meals in real-time.
        </p>
      </div>

      {!orders || orders.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No active orders"
            description="Track your incoming meals here once you place an order."
            action={
              <Link
                href="/home"
                className={buttonVariants({ variant: "primary" })}
              >
                Browse vendors
              </Link>
            }
          />
        </div>
      ) : (
        <OrdersList orders={orders} vendors={vendors} />
      )}
    </div>
  );
}
