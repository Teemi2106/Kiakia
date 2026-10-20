import "server-only";
import type { Json } from "@kiakia/db";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { toBankDetails, type BankDetails } from "./bank";
import { loadProfiles, loadVendorNames, unwrap, type AdminClient } from "./lookups";
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

/** Time ranges the Overview's Money section can show. Default is 30 days. */
export const MONEY_RANGES = ["today", "7d", "30d", "all"] as const;
export type MoneyRange = (typeof MONEY_RANGES)[number];
export const DEFAULT_MONEY_RANGE: MoneyRange = "all";

/** Reads the `range` search param; anything unrecognised falls back to the default. */
export function parseMoneyRange(value: string | undefined): MoneyRange {
  return (MONEY_RANGES as readonly string[]).includes(value ?? "") ? (value as MoneyRange) : DEFAULT_MONEY_RANGE;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WAT_OFFSET_MS = 60 * 60 * 1000;

/**
 * The [from, to) the RPC filters on. "Today" starts at midnight in Nigeria
 * (WAT, UTC+1, no daylight saving); 7 and 30 days are rolling, like the
 * delivered-order cards beside it. "all" is the open window. `to` is always
 * open-ended so a payment landing while the page renders is still counted.
 */
export function moneyRangeWindow(range: MoneyRange, now: Date = new Date()): { from: string | null; to: null } {
  switch (range) {
    case "all":
      return { from: null, to: null };
    case "today": {
      const localMidnight = Math.floor((now.getTime() + WAT_OFFSET_MS) / DAY_MS) * DAY_MS - WAT_OFFSET_MS;
      return { from: new Date(localMidnight).toISOString(), to: null };
    }
    case "7d":
      return { from: new Date(now.getTime() - 7 * DAY_MS).toISOString(), to: null };
    case "30d":
      return { from: new Date(now.getTime() - 30 * DAY_MS).toISOString(), to: null };
  }
}

/**
 * admin_money_summary() (0091), ledger-derived, kobo. Flows cover the requested
 * window; the "right now" group and the reconciliation do not depend on it.
 */
export interface MoneySummary {
  readonly generatedAt: string;
  /** Total customers paid in the window: delivered, in progress, and later refunded. */
  readonly processedKobo: number;
  readonly processedCardKobo: number;
  readonly processedWalletKobo: number;
  readonly deliveredGmvKobo: number;
  readonly deliveredOrders: number;
  readonly platformEarningsKobo: number;
  readonly vendorEarnedKobo: number;
  readonly riderEarnedKobo: number;
  readonly refundedKobo: number;
  readonly refundedGatewayKobo: number;
  readonly refundedWalletKobo: number;
  readonly paidToVendorsInWindowKobo: number;
  readonly paidToRidersInWindowKobo: number;
  /** Right now, whatever the window. */
  readonly heldInEscrowKobo: number;
  readonly owedToVendorsKobo: number;
  readonly owedToRidersKobo: number;
  readonly paidToVendorsKobo: number;
  readonly paidToRidersKobo: number;
  readonly customerWalletKobo: number;
  readonly reconciliation: {
    readonly reconciles: boolean;
    readonly differenceKobo: number;
    readonly capturedKobo: number;
    readonly heldKobo: number;
    readonly releasedKobo: number;
    readonly refundedKobo: number;
  };
}

function field(source: Record<string, unknown>, key: string): number {
  const value = Number(source[key]);
  if (source[key] === null || source[key] === undefined || !Number.isFinite(value)) {
    throw new Error(`admin_money_summary: missing or invalid ${key}`);
  }
  return value;
}

/** Maps the RPC's jsonb document to the typed summary; throws if a figure is missing so a half-built page never shows zeros for "unknown". */
export function toMoneySummary(raw: unknown): MoneySummary {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("admin_money_summary: unexpected response");
  const doc = raw as Record<string, unknown>;
  const rec = doc.reconciliation;
  if (typeof rec !== "object" || rec === null || Array.isArray(rec)) throw new Error("admin_money_summary: missing reconciliation");
  const r = rec as Record<string, unknown>;
  return {
    generatedAt: String(doc.generated_at ?? ""),
    processedKobo: field(doc, "gross_processed_kobo"),
    processedCardKobo: field(doc, "gross_processed_card_kobo"),
    processedWalletKobo: field(doc, "gross_processed_wallet_kobo"),
    deliveredGmvKobo: field(doc, "delivered_gmv_kobo"),
    deliveredOrders: field(doc, "delivered_orders"),
    platformEarningsKobo: field(doc, "platform_earnings_kobo"),
    vendorEarnedKobo: field(doc, "vendor_earned_kobo"),
    riderEarnedKobo: field(doc, "rider_earned_kobo"),
    refundedKobo: field(doc, "refunded_kobo"),
    refundedGatewayKobo: field(doc, "refunded_gateway_kobo"),
    refundedWalletKobo: field(doc, "refunded_wallet_kobo"),
    paidToVendorsInWindowKobo: field(doc, "paid_out_to_vendors_window_kobo"),
    paidToRidersInWindowKobo: field(doc, "paid_out_to_riders_window_kobo"),
    heldInEscrowKobo: field(doc, "held_in_escrow_kobo"),
    owedToVendorsKobo: field(doc, "owed_to_vendors_kobo"),
    owedToRidersKobo: field(doc, "owed_to_riders_kobo"),
    paidToVendorsKobo: field(doc, "paid_out_to_vendors_kobo"),
    paidToRidersKobo: field(doc, "paid_out_to_riders_kobo"),
    customerWalletKobo: field(doc, "customer_wallet_float_kobo"),
    reconciliation: {
      reconciles: r.reconciles === true,
      differenceKobo: field(r, "difference_kobo"),
      capturedKobo: field(r, "captured_kobo"),
      heldKobo: field(r, "held_kobo"),
      releasedKobo: field(r, "released_kobo"),
      refundedKobo: field(r, "refunded_kobo"),
    },
  };
}

export async function getMoneySummary(range: MoneyRange = DEFAULT_MONEY_RANGE): Promise<MoneySummary> {
  await requireAdminContext();
  const { from, to } = moneyRangeWindow(range);
  const { data, error } = await createAdminClient().rpc("admin_money_summary", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return toMoneySummary(data);
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
  readonly auditId: string;
  /** The bank's reference the admin typed when recording the transfer. */
  readonly reference: string;
  readonly amountKobo: number;
  readonly createdAt: string;
  /** The admin who recorded it. */
  readonly recordedBy: string | null;
  readonly note: string | null;
}

type PayoutAuditRow = { id: string; actor_id: string; reason: string | null; details: Json; created_at: string };

/** Reads a payout.record audit row; null when its details do not carry a reference and amount. */
function toPayoutRecord(row: PayoutAuditRow, actors: Map<string, { fullName: string | null }>): PayoutRecord | null {
  const details = typeof row.details === "object" && row.details !== null && !Array.isArray(row.details) ? row.details : {};
  const reference = details.external_reference;
  const amount = details.amount_kobo;
  if (typeof reference !== "string" || typeof amount !== "number") return null;
  return {
    auditId: row.id,
    reference,
    amountKobo: amount,
    createdAt: row.created_at,
    recordedBy: actors.get(row.actor_id)?.fullName ?? null,
    note: row.reason,
  };
}

const PAYOUT_AUDIT_COLUMNS = "id, actor_id, reason, details, created_at, target_type, target_id";

/**
 * The owner's most recent recorded payouts (newest first). Read from the audit
 * log rather than the ledger because it also says who recorded each one;
 * admin_record_payout writes the ledger entries and this row in one
 * transaction, so the two cannot disagree.
 */
export async function loadRecentPayouts(admin: AdminClient, ownerType: "vendor" | "rider", ownerId: string, limit = 20): Promise<PayoutRecord[]> {
  const rows =
    unwrap(
      await admin
        .from("admin_audit_log")
        .select(PAYOUT_AUDIT_COLUMNS)
        .eq("action", "payout.record")
        .eq("target_type", ownerType)
        .eq("target_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(limit),
    ) ?? [];
  const actors = await loadProfiles(admin, rows.map((row) => row.actor_id));
  return rows.flatMap((row) => toPayoutRecord(row, actors) ?? []);
}

export interface PayoutHistoryItem extends PayoutRecord {
  readonly ownerType: "vendor" | "rider";
  readonly ownerId: string;
  readonly ownerName: string | null;
}

/** Every recorded payout, newest first: the Payouts page's History tab. */
export async function listPayoutHistory(params: PageParams = {}): Promise<Page<PayoutHistoryItem>> {
  await requireAdminContext();
  const admin = createAdminClient();
  const { page, pageSize, from, to } = pageWindow(params);

  const { data, error, count } = await admin
    .from("admin_audit_log")
    .select(PAYOUT_AUDIT_COLUMNS, { count: "exact" })
    .eq("action", "payout.record")
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const [actors, vendorNames, riderProfiles] = await Promise.all([
    loadProfiles(admin, rows.map((row) => row.actor_id)),
    loadVendorNames(admin, rows.filter((row) => row.target_type === "vendor").map((row) => row.target_id)),
    loadProfiles(admin, rows.filter((row) => row.target_type === "rider").map((row) => row.target_id)),
  ]);

  return {
    rows: rows.flatMap((row) => {
      const record = toPayoutRecord(row, actors);
      if (!record || (row.target_type !== "vendor" && row.target_type !== "rider")) return [];
      return [
        {
          ...record,
          ownerType: row.target_type,
          ownerId: row.target_id,
          ownerName: row.target_type === "vendor" ? (vendorNames.get(row.target_id) ?? null) : (riderProfiles.get(row.target_id)?.fullName ?? null),
        },
      ];
    }),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export interface Payable {
  readonly ownerType: "vendor" | "rider";
  readonly ownerId: string;
  readonly displayName: string | null;
  /** What the platform owes them now. */
  readonly balanceKobo: number;
  readonly disbursedKobo: number;
  /** Riders only; vendors have no bank details on file. Masked: this is a list view. */
  readonly bank: BankDetails | null;
}

/** Vendors and riders the platform owes money, largest first. totalOwedKobo covers every page. */
export async function listPayables(params: PageParams = {}): Promise<Page<Payable> & { readonly totalOwedKobo: number }> {
  await requireAdminContext();
  const { page, pageSize, from } = pageWindow(params);

  const { data, error } = await createAdminClient().rpc("admin_list_payables", { p_limit: pageSize, p_offset: from });
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  return {
    rows: rows.map((row) => ({
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      displayName: row.display_name,
      balanceKobo: row.balance_kobo,
      disbursedKobo: row.disbursed_kobo,
      bank: toBankDetails({ bankName: row.bank_name, accountName: row.bank_account_name, accountNumber: row.bank_account_number }, false),
    })),
    total: rows[0]?.total_count ?? 0,
    totalOwedKobo: rows[0]?.total_owed_kobo ?? 0,
    page,
    pageSize,
  };
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
