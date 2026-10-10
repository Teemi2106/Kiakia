import "server-only";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { toBankDetails, type BankDetails } from "./bank";
import { unwrap, type AdminClient } from "./lookups";
import { pageWindow, type Page, type PageParams } from "./query";

/** Shape of admin_dashboard_metrics() (0081). Money is kobo. */
export interface DashboardMetrics {
  readonly generated_at: string;
  /** Active pipeline only; every status is present, zero when empty. */
  readonly orders_by_status: Readonly<
    Record<"placed" | "accepted" | "preparing" | "ready_for_pickup" | "rider_assigned" | "picked_up" | "in_transit" | "arrived", number>
  >;
  readonly delivered: Readonly<Record<"last_24h" | "last_7d" | "last_30d", { orders: number; gmv_kobo: number }>>;
  readonly platform_revenue_30d_kobo: number;
  readonly riders: { readonly online: number; readonly pending_kyc: number; readonly documents_pending: number };
  readonly vendors_suspended: number;
  readonly stuck_orders: {
    /** ready_for_pickup, no rider, ready for more than 15 minutes. */
    readonly ready_without_rider: number;
    /** arrived and locked out of the delivery code (5 failed attempts). */
    readonly delivery_code_locked: number;
    /** failed_delivery with the payment still paid, i.e. escrow neither released nor refunded. */
    readonly failed_delivery_escrow_held: number;
  };
  readonly capture_anomalies_7d: { readonly duplicate_capture: number; readonly underpaid_capture: number; readonly amount_mismatch: number };
  /** Orders whose ledger refund went to the gateway, by Monnify request state. */
  readonly gateway_refunds: { readonly not_requested: number; readonly pending: number; readonly failed: number };
}

/** Shape of admin_ledger_health() (0081). */
export interface LedgerHealth {
  readonly checked_at: string;
  readonly unbalanced_transactions: {
    readonly count: number;
    readonly sample: readonly { transaction_id: string; reference: string; debit_kobo: number; credit_kobo: number }[];
  };
  readonly totals: { readonly debit_kobo: number; readonly credit_kobo: number; readonly difference_kobo: number };
  /** drift_kobo = actual - expected; non-zero means escrow does not match the orders it should be holding for. */
  readonly escrow: { readonly actual_kobo: number; readonly expected_kobo: number; readonly drift_kobo: number };
  /** Non-gateway accounts below zero (the gateway account runs negative by design). */
  readonly negative_accounts: readonly {
    account_id: string;
    owner_type: "platform" | "vendor" | "rider" | "customer";
    owner_id: string | null;
    kind: string;
    balance_kobo: number;
  }[];
}

export type BalanceOwnerType = "vendor" | "rider" | "customer";

export interface OwnerBalance {
  readonly ownerId: string;
  readonly displayName: string | null;
  /** Vendor/rider available balance, or customer wallet. */
  readonly balanceKobo: number;
  /** Total already paid out through payout transactions. */
  readonly disbursedKobo: number;
  /** Riders only. */
  readonly bank: BankDetails | null;
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  await requireAdminContext();
  const { data, error } = await createAdminClient().rpc("admin_dashboard_metrics");
  if (error) throw new Error(error.message);
  return data as unknown as DashboardMetrics;
}

export async function getLedgerHealth(): Promise<LedgerHealth> {
  await requireAdminContext();
  const { data, error } = await createAdminClient().rpc("admin_ledger_health");
  if (error) throw new Error(error.message);
  return data as unknown as LedgerHealth;
}

/** Payables page: owners with a ledger account, richest balance first. A list view: account numbers are always masked. */
export async function listBalances(ownerType: BalanceOwnerType, params: PageParams = {}): Promise<Page<OwnerBalance>> {
  await requireAdminContext();
  const { page, pageSize, from } = pageWindow(params);

  const { data, error } = await createAdminClient().rpc("admin_list_balances", {
    p_owner_type: ownerType,
    p_limit: pageSize,
    p_offset: from,
  });
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  return { rows: rows.map((row) => toOwnerBalance(row)), total: rows[0]?.total_count ?? 0, page, pageSize };
}

/**
 * One owner's ledger-derived figures — the same derivation as the list, so a
 * detail page can never disagree with the payouts page. Null when the owner has
 * no account yet (never earned / never held wallet money). Not exported to
 * pages directly: vendor/rider/user detail loaders embed it. Account numbers
 * are masked here; getRiderDetail() carries the full one for finance admins.
 */
export async function loadOwnerBalance(admin: AdminClient, ownerType: BalanceOwnerType, ownerId: string): Promise<OwnerBalance | null> {
  const rows = unwrap(await admin.rpc("admin_list_balances", { p_owner_type: ownerType, p_limit: 1, p_offset: 0, p_owner_id: ownerId }));
  return rows?.[0] ? toOwnerBalance(rows[0]) : null;
}

export interface PayoutRecord {
  readonly transactionId: string;
  readonly reference: string;
  readonly amountKobo: number;
  readonly createdAt: string;
}

/** The owner's most recent payouts (newest first). Debits on an available account are payouts by construction (0081). */
export async function loadRecentPayouts(admin: AdminClient, ownerType: "vendor" | "rider", ownerId: string, limit = 20): Promise<PayoutRecord[]> {
  const account = unwrap(
    await admin.from("accounts").select("id").eq("owner_type", ownerType).eq("owner_id", ownerId).eq("kind", "available").maybeSingle(),
  );
  if (!account) return [];

  const entries =
    unwrap(
      await admin
        .from("ledger_entries")
        .select("transaction_id, amount_kobo, created_at")
        .eq("account_id", account.id)
        .eq("direction", "debit")
        .order("created_at", { ascending: false })
        .limit(limit),
    ) ?? [];
  if (entries.length === 0) return [];

  const transactions =
    unwrap(
      await admin
        .from("transactions")
        .select("id, reference")
        .eq("kind", "payout")
        .in(
          "id",
          entries.map((entry) => entry.transaction_id),
        ),
    ) ?? [];
  const references = new Map(transactions.map((transaction) => [transaction.id, transaction.reference]));

  return entries.flatMap((entry) => {
    const reference = references.get(entry.transaction_id);
    return reference
      ? [{ transactionId: entry.transaction_id, reference, amountKobo: entry.amount_kobo, createdAt: entry.created_at }]
      : [];
  });
}

function toOwnerBalance(
  row: {
    owner_id: string;
    display_name: string | null;
    balance_kobo: number;
    disbursed_kobo: number;
    bank_name: string | null;
    bank_account_name: string | null;
    bank_account_number: string | null;
  },
): OwnerBalance {
  return {
    ownerId: row.owner_id,
    displayName: row.display_name,
    balanceKobo: row.balance_kobo,
    disbursedKobo: row.disbursed_kobo,
    bank: toBankDetails({ bankName: row.bank_name, accountName: row.bank_account_name, accountNumber: row.bank_account_number }, false),
  };
}
