// app/(vendor)/earnings/page.tsx
import { getVendorForCurrentUser, requireVendorContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EarningsDesktop } from "./_components/EarningsDesktop";
import { EarningsMobile } from "./_components/EarningsMobile";

export const metadata: Metadata = { title: "Earnings" };

/**
 * `accounts` and `ledger_entries` have ALL privileges revoked from
 * `authenticated` (supabase/migrations/0007_rls.sql) — there is no vendor-
 * facing RLS policy on either table, so the user-scoped client silently
 * errors on both reads. This page reads them via the admin (service-role)
 * client instead, same reasoning as the (admin) pages, but every query below
 * is scoped by `.eq("owner_id", vendor.id)` / `.in("account_id", accountIds)`
 * derived from that — the WHERE clause is what enforces "this vendor's own
 * balances only" now that RLS no longer does.
 *
 * requireVendorContext() is called explicitly here (not just
 * getVendorForCurrentUser(), which only verifies a session exists, not a
 * vendor role or active vendor mode) for the same defense-in-depth reasoning
 * as the (admin) pages — don't rely solely on (vendor)/layout.tsx having run.
 */
export default async function VendorEarningsPage() {
  await requireVendorContext();

  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

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

  const available =
    (accounts ?? []).find((a) => a.kind === "available") &&
    (balances ?? []).find(
      (b) =>
        b.account_id ===
        (accounts ?? []).find((a) => a.kind === "available")?.id,
    );
  const pending =
    (accounts ?? []).find((a) => a.kind === "pending_payout") &&
    (balances ?? []).find(
      (b) =>
        b.account_id ===
        (accounts ?? []).find((a) => a.kind === "pending_payout")?.id,
    );

  const availableKobo = available?.balance_kobo ?? 0;
  const pendingKobo = pending?.balance_kobo ?? 0;

  const { data: realPayouts, error: payoutsError } = accountIds.length
    ? await admin
        .from("ledger_entries")
        .select("id, amount_kobo, direction, entry_type, created_at")
        .in("account_id", accountIds)
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: [], error: null };

  if (payoutsError) {
    throw new Error(payoutsError.message);
  }

  const payouts = realPayouts || [];

  return (
    <>
      <div className="hidden lg:block">
        <EarningsDesktop
          availableKobo={availableKobo}
          pendingKobo={pendingKobo}
          payouts={payouts}
        />
      </div>
      <div className="lg:hidden">
        <EarningsMobile
          availableKobo={availableKobo}
          pendingKobo={pendingKobo}
          payouts={payouts}
        />
      </div>
    </>
  );
}
