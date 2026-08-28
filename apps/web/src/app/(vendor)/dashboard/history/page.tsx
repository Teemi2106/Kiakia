// app/(vendor)/history/page.tsx
import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { PackageSearch } from "lucide-react";
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

export default async function VendorHistoryPage() {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  const supabase = await createClient();

  const { data: realOrders } = await supabase
    .from("orders")
    .select("id, code, status, total_kobo, created_at")
    .eq("vendor_id", vendor.id)
    .in("status", TERMINAL_STATUSES)
    .order("created_at", { ascending: false })
    .limit(100);
  const orders = realOrders || [];

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
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-[#E4BEB8] bg-white px-6 py-16 text-center shadow-sm">
          <div className="flex size-14 items-center justify-center rounded-full bg-[#F6F3F2] text-[#B61913]">
            <PackageSearch className="size-7" />
          </div>
          <div>
            <h2 className="font-sora text-lg font-bold text-[#1C1B1B]">
              No past orders yet
            </h2>
            <p className="mt-1 max-w-sm text-sm text-[#5B403C]">
              Completed, cancelled, and rejected orders will show up here once
              you&apos;ve fulfilled your first delivery.
            </p>
          </div>
          <Link
            href="/dashboard/orders"
            className="mt-2 rounded-xl bg-[#B61913] px-6 py-3 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#9e1611] active:scale-95"
          >
            View active orders
          </Link>
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
