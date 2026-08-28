// app/(customer)/orders/page.tsx
import { EmptyState, buttonVariants } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { OrdersList } from "./_components/OrdersList";
import type { Order } from "./_components/types";

export const metadata: Metadata = { title: "Orders" };

const TERMINAL_STATUSES = [
  "delivered",
  "rejected_by_vendor",
  "failed_delivery",
  "cancelled_by_customer",
  "cancelled_by_platform",
] as const;

interface DeliveryAddress {
  line1?: string;
  landmark?: string;
  city?: string;
  state?: string;
}

/** Same shape/convention as the vendor dashboard's orders list — jsonb
 * {line1, landmark, city, state} (0032_vendor_location_and_rider_reads.sql). */
function formatAddress(address: unknown): string | undefined {
  const a = address as DeliveryAddress | null;
  if (!a?.line1) return undefined;
  const parts = [a.line1, a.landmark ? `near ${a.landmark}` : null, a.city, a.state].filter(
    Boolean,
  );
  return parts.join(", ");
}

export default async function ActiveOrdersPage() {
  const session = await verifySession();
  const supabase = await createClient();

  const { data: realOrders } = await supabase
    .from("orders")
    .select("id, code, status, total_kobo, vendor_id, created_at, delivery_address")
    .eq("customer_id", session.userId)
    .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
    .order("created_at", { ascending: false });

  const rawOrders = realOrders ?? [];

  const vendorIds = [...new Set(rawOrders.map((o) => o.vendor_id))];
  const orderIds = rawOrders.map((o) => o.id);

  const [{ data: realVendors }, { data: itemRows }] = await Promise.all([
    vendorIds.length
      ? supabase.from("vendors").select("id, name, logo_url").in("id", vendorIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabase.from("order_items").select("order_id, name_snapshot, qty").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
  ]);
  const vendors = realVendors ?? [];

  const itemsByOrderId = new Map<string, Array<{ name: string; qty: number }>>();
  for (const row of itemRows ?? []) {
    const list = itemsByOrderId.get(row.order_id) ?? [];
    list.push({ name: row.name_snapshot, qty: row.qty });
    itemsByOrderId.set(row.order_id, list);
  }

  const orders: Order[] = rawOrders.map((order) => ({
    id: order.id,
    code: order.code,
    status: order.status,
    total_kobo: order.total_kobo,
    vendor_id: order.vendor_id,
    created_at: order.created_at,
    delivery_address: formatAddress(order.delivery_address),
    items: itemsByOrderId.get(order.id) ?? [],
  }));

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

      {orders.length === 0 ? (
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
