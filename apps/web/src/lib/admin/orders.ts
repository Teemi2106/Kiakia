import "server-only";
import { ORDER_STATUSES } from "@kiakia/domain";
import type { Json, OrderRow, OrderStatus } from "@kiakia/db";
import { z } from "zod";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadProfiles, loadVendorNames, unwrap, type AdminClient, type ProfileSummary } from "./lookups";
import { emptyPage, ESTIMATE_THRESHOLD, optionalDate, optionalUuid, pageWindow, searchTerm, type Page, type PageParams } from "./query";

export interface OrderListFilters extends PageParams {
  /** Matches the order code. */
  readonly q?: string;
  readonly status?: string;
  readonly vendorId?: string;
  /** Inclusive, YYYY-MM-DD, compared against created_at. */
  readonly from?: string;
  readonly to?: string;
}

export interface OrderListItem {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly paymentStatus: OrderRow["payment_status"];
  readonly totalKobo: number;
  readonly createdAt: string;
  readonly vendorId: string;
  readonly vendorName: string | null;
  readonly customerId: string;
  readonly customerName: string | null;
  readonly riderId: string | null;
}

const filterSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional().catch(undefined),
  vendorId: optionalUuid,
  from: optionalDate,
  to: optionalDate,
});

export async function listOrders(filters: OrderListFilters = {}): Promise<Page<OrderListItem>> {
  await requireAdminContext();
  const admin = createAdminClient();
  const { page, pageSize, from, to } = pageWindow(filters);
  const parsed = filterSchema.parse(filters);
  const term = searchTerm(filters.q);

  let query = admin
    .from("orders")
    .select("id, code, status, payment_status, total_kobo, created_at, vendor_id, customer_id, rider_id", { count: "estimated" })
    .order("created_at", { ascending: false })
    // One row past the page tells us whether a next page exists without trusting the estimated count.
    .range(from, to + 1);

  if (term) query = query.ilike("code", `%${term}%`);
  if (parsed.status) query = query.eq("status", parsed.status);
  if (parsed.vendorId) query = query.eq("vendor_id", parsed.vendorId);
  if (parsed.from) query = query.gte("created_at", `${parsed.from}T00:00:00Z`);
  if (parsed.to) query = query.lt("created_at", nextDay(parsed.to));

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return { ...emptyPage<OrderListItem>(filters), total: count ?? 0, hasNext: false };
  const hasNext = data.length > pageSize;
  const pageRows = data.slice(0, pageSize);

  const [vendors, customers] = await Promise.all([
    loadVendorNames(admin, pageRows.map((order) => order.vendor_id)),
    loadProfiles(admin, pageRows.map((order) => order.customer_id)),
  ]);

  return {
    rows: pageRows.map((order) => ({
      id: order.id,
      code: order.code,
      status: order.status,
      paymentStatus: order.payment_status,
      totalKobo: order.total_kobo,
      createdAt: order.created_at,
      vendorId: order.vendor_id,
      vendorName: vendors.get(order.vendor_id) ?? null,
      customerId: order.customer_id,
      customerName: customers.get(order.customer_id)?.fullName ?? null,
      riderId: order.rider_id,
    })),
    total: count ?? pageRows.length,
    page,
    pageSize,
    hasNext,
    approximateTotal: (count ?? 0) > ESTIMATE_THRESHOLD,
  };
}

export interface RecentOrderView {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly paymentStatus: OrderRow["payment_status"];
  readonly totalKobo: number;
  readonly createdAt: string;
}

/** An owner's newest orders, for the vendor / rider / user detail pages. */
export async function loadRecentOrders(
  admin: AdminClient,
  column: "vendor_id" | "rider_id" | "customer_id",
  ownerId: string,
  limit = 20,
): Promise<RecentOrderView[]> {
  const rows =
    unwrap(
      await admin
        .from("orders")
        .select("id, code, status, payment_status, total_kobo, created_at")
        .eq(column, ownerId)
        .order("created_at", { ascending: false })
        .limit(limit),
    ) ?? [];

  return rows.map((order) => ({
    id: order.id,
    code: order.code,
    status: order.status,
    paymentStatus: order.payment_status,
    totalKobo: order.total_kobo,
    createdAt: order.created_at,
  }));
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

export interface OrderItemView {
  readonly id: string;
  readonly name: string;
  readonly unitPriceKobo: number;
  readonly qty: number;
  readonly lineTotalKobo: number;
  readonly options: Json;
}

export interface OrderEventView {
  readonly id: string;
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus;
  readonly actorType: "customer" | "vendor" | "rider" | "system" | "admin";
  readonly actorId: string | null;
  readonly at: string;
  /** Carries capture anomalies (duplicate_capture_attempt, underpaid_capture, ...) and refund details. */
  readonly meta: Json;
}

export interface OrderPaymentView {
  readonly id: string;
  readonly provider: string;
  readonly providerRef: string;
  readonly amountKobo: number;
  readonly channel: string | null;
  readonly status: "pending" | "success" | "failed" | "refunded";
  readonly refundReference: string | null;
  readonly refundStatus: "pending" | "completed" | "failed" | null;
  readonly createdAt: string;
}

export interface OrderLedgerEntryView {
  readonly id: string;
  readonly transactionReference: string;
  readonly transactionKind: string;
  readonly direction: "debit" | "credit";
  readonly amountKobo: number;
  readonly entryType: string;
  /** e.g. platform:escrow, vendor:available, customer:wallet. */
  readonly account: string;
  readonly accountOwnerId: string | null;
  readonly createdAt: string;
}

/** Where the captured money for an order stands, derived from its ledger entries (not event meta). */
export interface OrderEscrowView {
  /** none: nothing captured; held: in platform escrow; released: paid out on delivery; refunded: reversed. */
  readonly state: "none" | "held" | "released" | "refunded";
  /** Set when state is refunded: the account the refund credited. */
  readonly refundDestination: "wallet" | "gateway" | null;
}

/**
 * Statuses at which admin_reassign_order_rider() (0083) can change an order's rider:
 * nothing has been picked up yet. From picked_up onward it refuses.
 */
const REASSIGNABLE_STATUSES: readonly OrderStatus[] = ["accepted", "preparing", "ready_for_pickup", "rider_assigned"];

export interface OrderDetail {
  /** The order row. The delivery code lives in a separate table and is never loaded. */
  readonly order: OrderRow;
  readonly items: readonly OrderItemView[];
  /** Oldest first. */
  readonly events: readonly OrderEventView[];
  /** Null for a wallet-paid order or one that never reached checkout. */
  readonly payment: OrderPaymentView | null;
  /** Oldest first. */
  readonly ledger: readonly OrderLedgerEntryView[];
  readonly escrow: OrderEscrowView;
  /**
   * Whether to show the dispatch override. With a rider on the order it offers "unassign and re-offer"
   * and "assign another rider"; without one, "offer to riders now" and "assign a rider".
   */
  readonly canReassignRider: boolean;
  readonly vendor: { readonly id: string; readonly name: string; readonly status: "pending" | "active" | "suspended" } | null;
  readonly customer: ProfileSummary | null;
  readonly rider: ProfileSummary | null;
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail | null> {
  await requireAdminContext();
  if (!z.string().uuid().safeParse(orderId).success) return null;
  const admin = createAdminClient();

  const order = unwrap(await admin.from("orders").select("*").eq("id", orderId).maybeSingle());
  if (!order) return null;

  const [items, events, payment, entries, vendor, profiles] = await Promise.all([
    admin.from("order_items").select("id, name_snapshot, unit_price_kobo, qty, options_snapshot, line_total_kobo").eq("order_id", orderId),
    admin.from("order_events").select("id, from_status, to_status, actor_type, actor_id, at, meta").eq("order_id", orderId).order("at", { ascending: true }),
    admin
      .from("payments")
      .select("id, provider, provider_ref, amount_kobo, channel, status, refund_reference, refund_status, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("ledger_entries").select("id, transaction_id, account_id, direction, amount_kobo, entry_type, created_at").eq("order_id", orderId).order("created_at", { ascending: true }),
    admin.from("vendors").select("id, name, status").eq("id", order.vendor_id).maybeSingle(),
    loadProfiles(admin, [order.customer_id, order.rider_id]),
  ]);

  const ledgerEntries = unwrap(entries) ?? [];

  const [accounts, transactions] = await Promise.all([
    ledgerEntries.length
      ? admin.from("accounts").select("id, owner_type, owner_id, kind").in("id", [...new Set(ledgerEntries.map((entry) => entry.account_id))])
      : null,
    ledgerEntries.length
      ? admin.from("transactions").select("id, reference, kind").in("id", [...new Set(ledgerEntries.map((entry) => entry.transaction_id))])
      : null,
  ]);
  const accountById = new Map((accounts ? unwrap(accounts) ?? [] : []).map((account) => [account.id, account]));
  const transactionById = new Map((transactions ? unwrap(transactions) ?? [] : []).map((transaction) => [transaction.id, transaction]));

  const paymentRow = unwrap(payment);

  const ledger = ledgerEntries.map((entry) => {
    const account = accountById.get(entry.account_id);
    const transaction = transactionById.get(entry.transaction_id);
    return {
      id: entry.id,
      transactionReference: transaction?.reference ?? "",
      transactionKind: transaction?.kind ?? "",
      direction: entry.direction,
      amountKobo: entry.amount_kobo,
      entryType: entry.entry_type,
      account: account ? `${account.owner_type}:${account.kind}` : "unknown",
      accountOwnerId: account?.owner_id ?? null,
      createdAt: entry.created_at,
    };
  });

  return {
    order,
    items: (unwrap(items) ?? []).map((item) => ({
      id: item.id,
      name: item.name_snapshot,
      unitPriceKobo: item.unit_price_kobo,
      qty: item.qty,
      lineTotalKobo: item.line_total_kobo,
      options: item.options_snapshot,
    })),
    events: (unwrap(events) ?? []).map((event) => ({
      id: event.id,
      fromStatus: event.from_status,
      toStatus: event.to_status,
      actorType: event.actor_type,
      actorId: event.actor_id,
      at: event.at,
      meta: event.meta,
    })),
    payment: paymentRow
      ? {
          id: paymentRow.id,
          provider: paymentRow.provider,
          providerRef: paymentRow.provider_ref,
          amountKobo: paymentRow.amount_kobo,
          channel: paymentRow.channel,
          status: paymentRow.status,
          refundReference: paymentRow.refund_reference,
          refundStatus: paymentRow.refund_status,
          createdAt: paymentRow.created_at,
        }
      : null,
    ledger,
    escrow: deriveEscrow(ledger),
    canReassignRider: REASSIGNABLE_STATUSES.includes(order.status) && order.delivery_by !== "vendor",
    vendor: unwrap(vendor),
    customer: profiles.get(order.customer_id) ?? null,
    rider: order.rider_id ? (profiles.get(order.rider_id) ?? null) : null,
  };
}

export interface AssignableRider {
  readonly riderId: string;
  readonly fullName: string | null;
  readonly phone: string | null;
  /** Straight-line distance to the vendor, in metres. */
  readonly pickupDistanceM: number;
  /** Exactly what assigning this rider would freeze as the order's rider fee. */
  readonly riderFeeKobo: number;
  readonly lastPingAt: string;
}

/**
 * The riders admin_reassign_order_rider() would accept for this order (approved,
 * active, online, a location under 5 minutes old, no other active order, fee
 * fundable), nearest the vendor first. The RPC owns the rules and the fee quote,
 * so what is listed here is what the assignment will accept.
 */
export async function listAssignableRiders(orderId: string, limit = 20): Promise<AssignableRider[]> {
  await requireAdminContext();
  if (!z.string().uuid().safeParse(orderId).success) return [];

  const rows = unwrap(await createAdminClient().rpc("admin_list_assignable_riders", { p_order_id: orderId, p_limit: limit })) ?? [];
  return rows.map((rider) => ({
    riderId: rider.rider_id,
    fullName: rider.full_name,
    phone: rider.phone,
    pickupDistanceM: rider.pickup_distance_m,
    riderFeeKobo: rider.rider_fee_kobo,
    lastPingAt: rider.last_ping_at,
  }));
}

function deriveEscrow(ledger: readonly OrderLedgerEntryView[]): OrderEscrowView {
  const refundCredit = ledger.find((entry) => entry.transactionKind === "refund" && entry.direction === "credit");
  if (refundCredit) {
    return { state: "refunded", refundDestination: refundCredit.account === "platform:gateway" ? "gateway" : "wallet" };
  }
  if (ledger.some((entry) => entry.transactionKind === "escrow_release")) return { state: "released", refundDestination: null };
  if (ledger.some((entry) => entry.account === "platform:escrow" && entry.direction === "credit")) {
    return { state: "held", refundDestination: null };
  }
  return { state: "none", refundDestination: null };
}
