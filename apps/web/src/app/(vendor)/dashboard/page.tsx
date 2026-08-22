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

// Demo data for development
const DEMO_ORDERS = [
  {
    id: "order-1",
    code: "KK-8892",
    status: "preparing",
    total_kobo: 1250000,
    created_at: new Date().toISOString(),
    items: "2x Extra Chicken, 1x Coke",
    eta: "12 mins left",
    image: null,
  },
  {
    id: "order-2",
    code: "KK-8895",
    status: "placed",
    total_kobo: 820000,
    created_at: new Date().toISOString(),
    items: "Assorted Meat, Goat Meat",
    eta: "Just now",
    image: null,
  },
  {
    id: "order-3",
    code: "KK-8889",
    status: "ready_for_pickup",
    total_kobo: 1500000,
    created_at: new Date().toISOString(),
    items: "Masa Side, Extra Spice",
    eta: "Driver: Emeka Q.",
    image: null,
  },
];

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

  // For demo, combine real data with demo data if needed
  const useDummyData = true;
  const orders = useDummyData ? DEMO_ORDERS : incoming || [];

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
