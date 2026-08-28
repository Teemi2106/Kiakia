// app/(vendor)/dashboard/page.tsx
import { getVendorForCurrentUser, requireVendorContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeVendorPendingEscrowKobo } from "@/lib/vendor-escrow";
import { EmptyState } from "@kiakia/ui";
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

const DISPATCH_STATUSES = ["rider_assigned", "picked_up", "in_transit", "arrived"] as const;

const SALES_DAYS = 7;
const SALES_EXCLUDED_STATUSES = [
  "draft",
  "rejected_by_vendor",
  "failed_delivery",
  "cancelled_by_customer",
  "cancelled_by_platform",
];

/**
 * `accounts` and `ledger_entries` have ALL privileges revoked from
 * `authenticated` (supabase/migrations/0007_rls.sql) — same reasoning as
 * dashboard/earnings/page.tsx (the reference implementation for this
 * pattern): read the vendor's escrow/available balances via the admin
 * (service-role) client, with every query scoped by
 * `.eq("owner_id", vendor.id)` / `.in("account_id", accountIds)` derived
 * from that — the WHERE clause is what enforces "this vendor's own
 * balances only" now that RLS no longer does.
 *
 * requireVendorContext() is called explicitly here (not just
 * getVendorForCurrentUser()) for the same defense-in-depth reasoning as
 * the earnings page — don't rely solely on (vendor)/layout.tsx having run.
 */
export default async function VendorDashboardPage() {
  await requireVendorContext();

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
  const admin = createAdminClient();

  const { data: accounts, error: accountsError } = await admin
    .from("accounts")
    .select("id, kind")
    .eq("owner_type", "vendor")
    .eq("owner_id", vendor.id);

  if (accountsError) {
    throw new Error(accountsError.message);
  }

  const accountIds = (accounts ?? []).map((a) => a.id);

  const { data: balances, error: balancesError } = accountIds.length
    ? await admin
        .from("account_balances")
        .select("account_id, balance_kobo")
        .in("account_id", accountIds)
    : { data: [], error: null };

  if (balancesError) {
    throw new Error(balancesError.message);
  }

  const balanceForKind = (kind: "available") => {
    const account = (accounts ?? []).find((a) => a.kind === kind);
    if (!account) return 0;
    return (
      (balances ?? []).find((b) => b.account_id === account.id)?.balance_kobo ?? 0
    );
  };

  // No vendor-scoped `escrow` account is ever created (see
  // lib/vendor-escrow.ts's header) — derived from live orders instead of a
  // ledger balance that's always zero.
  const escrowKobo = await computeVendorPendingEscrowKobo(supabase, admin, vendor.id, vendor.commission_bps);
  const availableKobo = balanceForKind("available");

  const salesWindowStart = new Date();
  salesWindowStart.setHours(0, 0, 0, 0);
  salesWindowStart.setDate(salesWindowStart.getDate() - (SALES_DAYS - 1));

  const [{ count: activeCount }, { count: preparingCount }, { count: dispatchCount }, { data: incoming }, { data: recentOrders }] =
    await Promise.all([
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("vendor_id", vendor.id)
        .in("status", ACTIVE_STATUSES),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("vendor_id", vendor.id)
        .eq("status", "preparing"),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("vendor_id", vendor.id)
        .in("status", DISPATCH_STATUSES),
      supabase
        .from("orders")
        .select("id, code, status, total_kobo, created_at")
        .eq("vendor_id", vendor.id)
        .in("status", ["placed", "accepted", "preparing"])
        .order("created_at", { ascending: true })
        .limit(5),
      supabase
        .from("orders")
        .select("status, total_kobo, created_at")
        .eq("vendor_id", vendor.id)
        .gte("created_at", salesWindowStart.toISOString()),
    ]);

  const orders = incoming || [];
  const orderIds = orders.map((o) => o.id);

  const { data: orderItemRows } = orderIds.length
    ? await supabase
        .from("order_items")
        .select("order_id, name_snapshot, qty")
        .in("order_id", orderIds)
    : { data: [] };

  const itemSummaryByOrderId = new Map<string, string>();
  for (const row of orderItemRows ?? []) {
    const existing = itemSummaryByOrderId.get(row.order_id);
    const part = `${row.qty}× ${row.name_snapshot}`;
    itemSummaryByOrderId.set(row.order_id, existing ? `${existing}, ${part}` : part);
  }

  const ordersWithItems = orders.map((order) => ({
    ...order,
    items: itemSummaryByOrderId.get(order.id),
  }));

  // Real, derived daily sales for the last SALES_DAYS days — no synthetic
  // series. Days with no orders render as a real zero, not a fabricated bar.
  const salesByDay = new Map<string, number>();
  const dayLabels: { key: string; label: string }[] = [];
  for (let i = SALES_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dayLabels.push({ key, label: d.toLocaleDateString("en-US", { weekday: "short" }) });
    salesByDay.set(key, 0);
  }
  for (const order of recentOrders ?? []) {
    if (SALES_EXCLUDED_STATUSES.includes(order.status)) continue;
    const key = order.created_at.slice(0, 10);
    if (salesByDay.has(key)) {
      salesByDay.set(key, (salesByDay.get(key) ?? 0) + order.total_kobo);
    }
  }
  const salesData = dayLabels.map(({ key, label }) => ({
    day: label,
    salesKobo: salesByDay.get(key) ?? 0,
  }));

  return (
    <>
      <div className="hidden lg:block">
        <DashboardDesktop
          vendor={vendor}
          activeCount={activeCount ?? 0}
          escrowKobo={escrowKobo}
          availableKobo={availableKobo}
          orders={ordersWithItems}
          salesData={salesData}
        />
      </div>
      <div className="lg:hidden">
        <DashboardMobile
          vendor={vendor}
          activeCount={activeCount ?? 0}
          preparingCount={preparingCount ?? 0}
          dispatchCount={dispatchCount ?? 0}
          escrowKobo={escrowKobo}
          availableKobo={availableKobo}
          orders={ordersWithItems}
        />
      </div>
    </>
  );
}
