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

export default async function ActiveOrdersPage() {
  const session = await verifySession();
  const supabase = await createClient();

  const { data: realOrders } = await supabase
    .from("orders")
    .select("id, code, status, total_kobo, vendor_id, created_at")
    .eq("customer_id", session.userId)
    .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
    .order("created_at", { ascending: false });

  const orders = realOrders;

  const vendorIds = [...new Set((orders ?? []).map((o) => o.vendor_id))];
  const { data: realVendors } = vendorIds.length
    ? await supabase.from("vendors").select("id, name").in("id", vendorIds)
    : { data: [] };
  const vendors = realVendors ?? [];

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
