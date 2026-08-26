// app/(vendor)/dashboard/page.tsx
import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatNaira, koboOf } from "@kiakia/domain";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { DashboardDesktop } from "./_components/DashboardDesktop";
import { DashboardMobile } from "./_components/DashboardMobile";

export const metadata: Metadata = { title: "Dashboard" };

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

export default async function VendorDashboardPage() {
  const vendor = await getVendorForCurrentUser();

  if (!vendor) {
    return (
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <EmptyState
          title="No store linked to your account"
          description="Something went wrong during onboarding."
          action={
            <Link
              href="/onboarding"
              className="text-sm font-medium text-brand-600 hover:underline"
            >
              Try onboarding again →
            </Link>
          }
        />
      </div>
    );
  }

  const supabase = await createClient();

  const [{ count: activeCount }, { data: incoming }] = await Promise.all([
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendor.id)
      .in("status", ACTIVE_STATUSES),
    supabase
      .from("orders")
      .select("id, code, status, total_kobo, created_at")
      .eq("vendor_id", vendor.id)
      .in("status", ["placed", "accepted", "preparing"])
      .order("created_at", { ascending: true })
      .limit(5),
  ]);

  const orders = incoming || [];

  return (
    <>
      <div className="hidden lg:block">
        <DashboardDesktop
          vendor={vendor}
          activeCount={activeCount ?? 0}
          orders={orders}
        />
      </div>
      <div className="lg:hidden">
        <DashboardMobile
          vendor={vendor}
          activeCount={activeCount ?? 0}
          orders={orders}
        />
      </div>
    </>
  );
}
