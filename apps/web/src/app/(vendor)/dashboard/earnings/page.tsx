// app/(vendor)/earnings/page.tsx
import { getVendorForCurrentUser, requireVendorContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeVendorPendingEscrowKobo } from "@/lib/vendor-escrow";
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

  const supabase = await createClient();
  const admin = createAdminClient();

  // The accounts lookup and the derived pending figure are independent (no
  // vendor-scoped `pending_payout` account is ever created, see
  // lib/vendor-escrow.ts's header - pending is derived from live orders), so
  // they go out together; the balances and the ledger page both need the
  // account ids and then go out together too. Four round trips in a row before.
  const [accountsResult, pendingKobo] = await Promise.all([
    admin.from("accounts").select("id, kind").eq("owner_type", "vendor").eq("owner_id", vendor.id),
    computeVendorPendingEscrowKobo(supabase, admin, vendor.id, vendor.commission_bps),
  ]);

  if (accountsResult.error) {
    throw new Error(accountsResult.error.message);
  }

  const accounts = accountsResult.data ?? [];
  const accountIds = accounts.map((a) => a.id);

  const [balancesResult, payoutsResult] = accountIds.length
    ? await Promise.all([
        admin.from("account_balances").select("account_id, balance_kobo").in("account_id", accountIds),
        admin
          .from("ledger_entries")
          .select("id, amount_kobo, direction, entry_type, created_at")
          .in("account_id", accountIds)
          .order("created_at", { ascending: false })
          .limit(50),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  if (balancesResult.error) {
    throw new Error(balancesResult.error.message);
  }
  if (payoutsResult.error) {
    throw new Error(payoutsResult.error.message);
  }

  const availableAccountId = accounts.find((a) => a.kind === "available")?.id;
  const availableKobo = (balancesResult.data ?? []).find((b) => b.account_id === availableAccountId)?.balance_kobo ?? 0;
  const realPayouts = payoutsResult.data;

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
