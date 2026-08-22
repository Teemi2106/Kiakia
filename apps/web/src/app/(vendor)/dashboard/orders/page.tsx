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

// Demo data
const DEMO_ORDERS = [
  {
    id: "order-1",
    code: "ORD-7721",
    status: "placed",
    total_kobo: 1240000,
    created_at: new Date().toISOString(),
    customer_name: "Chioma Adebayo",
    customer_phone: "+234 802 345 6789",
    delivery_address: "Victoria Island, Lagos",
    customer_note:
      "Please make sure the okra is crunchy, not overcooked. Thanks!",
    eta: "25:00",
    items: [
      {
        id: "item-1",
        name: "Seafood Okra Feast (Large)",
        quantity: 1,
        price_kobo: 850000,
        image_url: null,
        options: "Extra prawns, No periwinkles",
      },
      {
        id: "item-2",
        name: "Grilled Croaker Fish",
        quantity: 2,
        price_kobo: 390000,
        image_url: null,
        options: "Spicy BBQ glaze",
      },
    ],
  },
  {
    id: "order-2",
    code: "ORD-7718",
    status: "preparing",
    total_kobo: 850000,
    created_at: new Date(Date.now() - 900000).toISOString(),
    customer_name: "Tunde Williams",
    customer_phone: "+234 803 456 7890",
    delivery_address: "Lekki, Lagos",
    customer_note: '"Please extra spicy!"',
    eta: "08:45",
    items: [
      {
        id: "item-3",
        name: "Party Jollof Rice",
        quantity: 3,
        price_kobo: 250000,
        image_url: null,
        options: "Extra spicy",
      },
    ],
  },
  {
    id: "order-3",
    code: "ORD-7715",
    status: "ready_for_pickup",
    total_kobo: 750000,
    created_at: new Date(Date.now() - 1800000).toISOString(),
    customer_name: "Amaka Johnson",
    customer_phone: "+234 804 567 8901",
    delivery_address: "Ikeja, Lagos",
    customer_note: null,
    eta: "Ready",
    items: [
      {
        id: "item-4",
        name: "Pounded Yam & Egusi",
        quantity: 1,
        price_kobo: 350000,
        image_url: null,
        options: null,
      },
      {
        id: "item-5",
        name: "Fresh Palm Wine",
        quantity: 1,
        price_kobo: 150000,
        image_url: null,
        options: null,
      },
    ],
  },
];

export default async function VendorOrdersPage() {
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
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: true });
    orders = realOrders || [];
  }

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
