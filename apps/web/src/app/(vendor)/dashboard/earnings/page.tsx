// app/(vendor)/earnings/page.tsx
import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatNaira, koboOf } from "@kiakia/domain";
import { Card, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EarningsDesktop } from "./_components/EarningsDesktop";
import { EarningsMobile } from "./_components/EarningsMobile";

export const metadata: Metadata = { title: "Earnings" };

// Demo data for development
const DEMO_PAYOUTS = [
  {
    id: "txn-984210",
    amount_kobo: 45000000,
    direction: "credit",
    entry_type: "payout",
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: "txn-984185",
    amount_kobo: 38520000,
    direction: "credit",
    entry_type: "payout",
    created_at: new Date(Date.now() - 172800000).toISOString(),
  },
  {
    id: "txn-984102",
    amount_kobo: 51200000,
    direction: "debit",
    entry_type: "pending",
    created_at: new Date(Date.now() - 259200000).toISOString(),
  },
  {
    id: "txn-984055",
    amount_kobo: 29045000,
    direction: "credit",
    entry_type: "payout",
    created_at: new Date(Date.now() - 345600000).toISOString(),
  },
];

export default async function VendorEarningsPage() {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  const supabase = await createClient();

  // Use demo data for development
  const useDummyData = true;
  let payouts = [];
  let availableKobo = 124580000;
  let pendingKobo = 34200050;

  if (!useDummyData) {
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, kind")
      .eq("owner_type", "vendor")
      .eq("owner_id", vendor.id);

    const accountIds = (accounts ?? []).map((a) => a.id);

    const { data: balances } = accountIds.length
      ? await supabase
          .from("account_balances")
          .select("account_id, balance_kobo")
          .in("account_id", accountIds)
      : { data: [] };

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

    availableKobo = available?.balance_kobo ?? 0;
    pendingKobo = pending?.balance_kobo ?? 0;

    const { data: realPayouts } = accountIds.length
      ? await supabase
          .from("ledger_entries")
          .select("id, amount_kobo, direction, entry_type, created_at")
          .in("account_id", accountIds)
          .order("created_at", { ascending: false })
          .limit(50)
      : { data: [] };
    payouts = realPayouts || [];
  } else {
    payouts = DEMO_PAYOUTS;
  }

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
