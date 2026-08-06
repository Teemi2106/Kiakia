import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatNaira, koboOf } from "@kiakia/domain";
import { Card, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Earnings" };

export default async function VendorEarningsPage() {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  const supabase = await createClient();

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, kind")
    .eq("owner_type", "vendor")
    .eq("owner_id", vendor.id);

  const accountIds = (accounts ?? []).map((a) => a.id);

  const { data: balances } = accountIds.length
    ? await supabase.from("account_balances").select("account_id, balance_kobo").in("account_id", accountIds)
    : { data: [] };

  const available =
    (accounts ?? []).find((a) => a.kind === "available") &&
    (balances ?? []).find((b) => b.account_id === (accounts ?? []).find((a) => a.kind === "available")?.id);
  const pending =
    (accounts ?? []).find((a) => a.kind === "pending_payout") &&
    (balances ?? []).find((b) => b.account_id === (accounts ?? []).find((a) => a.kind === "pending_payout")?.id);

  const availableKobo = available?.balance_kobo ?? 0;
  const pendingKobo = pending?.balance_kobo ?? 0;

  const { data: payouts } = accountIds.length
    ? await supabase
        .from("ledger_entries")
        .select("id, amount_kobo, direction, entry_type, created_at")
        .in("account_id", accountIds)
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: [] };

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">Earnings</h1>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Card>
          <p className="text-2xl font-semibold text-ink">{formatNaira(koboOf(availableKobo))}</p>
          <p className="text-xs text-ink-muted">Released Balance</p>
        </Card>
        <Card>
          <p className="text-2xl font-semibold text-ink">{formatNaira(koboOf(pendingKobo))}</p>
          <p className="text-xs text-ink-muted">Pending Settlements</p>
        </Card>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-ink">Payout History</h2>
        {!payouts || payouts.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No payouts yet"
              description="Escrow release to vendor accounts isn't live yet — this will populate once payouts start."
            />
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {payouts.map((entry) => (
              <Card key={entry.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium capitalize text-ink">{entry.entry_type.replace(/_/g, " ")}</p>
                    <p className="text-xs text-ink-muted">{new Date(entry.created_at).toLocaleDateString("en-NG")}</p>
                  </div>
                  <p className={`text-sm font-medium ${entry.direction === "credit" ? "text-positive" : "text-danger"}`}>
                    {entry.direction === "credit" ? "+" : "-"}
                    {formatNaira(koboOf(entry.amount_kobo))}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
