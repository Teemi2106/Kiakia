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
import { VendorOrderActions } from "../_components/VendorOrderActions";

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

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">{vendor.name}</h1>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Store Status</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="capitalize">Listing: {vendor.status}</p>
            <p className="capitalize">KYC: {vendor.kyc_status}</p>
            <p>
              {vendor.is_accepting_orders
                ? "Accepting orders"
                : "Not accepting orders"}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Orders</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-3xl font-semibold text-ink">
              {activeCount ?? 0}
            </p>
          </CardBody>
        </Card>
      </div>

      <h2 className="mt-6 text-sm font-semibold text-ink">Incoming Orders</h2>
      {!incoming || incoming.length === 0 ? (
        <div className="mt-3">
          <EmptyState title="No new orders right now" />
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {incoming.map((order) => (
            <Card key={order.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-ink">{order.code}</p>
                  <p className="text-sm text-ink-muted">
                    {formatNaira(koboOf(order.total_kobo))}
                  </p>
                </div>
                <Badge tone="warning">
                  {order.status.replaceAll("_", " ")}
                </Badge>
              </div>
              <div className="mt-3">
                <VendorOrderActions orderId={order.id} status={order.status} />
              </div>
              <Link
                href={`/dashboard/orders/${order.id}`}
                className="mt-2 block text-center text-xs font-medium text-brand-600 hover:underline"
              >
                View details →
              </Link>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-ink-muted">
        <Link href="/dashboard/earnings" className="hover:underline">
          Earnings, escrow balance, and payouts →
        </Link>
      </p>
    </div>
  );
}
