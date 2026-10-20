import "server-only";
import type { Role, Tables } from "@kiakia/db";
import { z } from "zod";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnerBalance, type OwnerBalance } from "./finance";
import { loadOrderCodes, unwrap, type AdminClient } from "./lookups";
import { loadRecentOrders, type RecentOrderView } from "./orders";
import { distinctIds, pageWindow, type Page, type PageParams } from "./query";

export interface UserListFilters extends PageParams {
  /** Matches name or phone. */
  readonly q?: string;
  readonly status?: string;
  /** Not 'customer': every account holds it, so it cannot narrow anything. */
  readonly role?: string;
}

export interface UserRoleView {
  readonly role: Role;
  readonly scopeType: "platform" | "vendor";
  readonly scopeId: string | null;
}

export interface UserListItem {
  readonly id: string;
  readonly fullName: string | null;
  readonly phone: string | null;
  readonly status: "active" | "suspended" | "deleted";
  readonly roles: readonly Role[];
  readonly createdAt: string;
}

const filterSchema = z.object({
  status: z.enum(["active", "suspended", "deleted"]).optional().catch(undefined),
  role: z.enum(["rider", "vendor_staff", "vendor_manager", "vendor_owner", "admin", "superadmin"]).optional().catch(undefined),
});

export async function listUsers(filters: UserListFilters = {}): Promise<Page<UserListItem>> {
  await requireAdminContext();
  const admin = createAdminClient();
  const { page, pageSize, from } = pageWindow(filters);
  const parsed = filterSchema.parse(filters);
  // The RPC treats the term as a literal substring, so it only needs trimming
  // and a length cap, not the .or()-safe reduction searchTerm() does.
  const term = filters.q?.trim().slice(0, 64) || null;

  const listPage = async (limit: number, offset: number) =>
    unwrap(
      await admin.rpc("admin_list_users", {
        p_q: term,
        p_status: parsed.status ?? null,
        p_role: parsed.role ?? null,
        p_limit: limit,
        p_offset: offset,
      }),
    ) ?? [];

  const rows = await listPage(pageSize, from);
  // total_count rides on each row, so a page past the end has no row to read it from.
  const total = rows.length > 0 || from === 0 ? (rows[0]?.total_count ?? 0) : ((await listPage(1, 0))[0]?.total_count ?? 0);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      status: row.status,
      roles: row.roles,
      createdAt: row.created_at,
    })),
    total,
    page,
    pageSize,
  };
}

export interface CustomerListFilters extends PageParams {
  /** Matches name or phone. */
  readonly q?: string;
  readonly status?: string;
}

export interface CustomerListItem {
  readonly id: string;
  readonly fullName: string | null;
  readonly phone: string | null;
  readonly status: "active" | "suspended" | "deleted";
  readonly createdAt: string;
  readonly orderCount: number;
  readonly walletBalanceKobo: number;
}

/** Accounts whose only role is customer. Anyone who is also a vendor, rider or admin is found on that page instead. */
export async function listCustomers(filters: CustomerListFilters = {}): Promise<Page<CustomerListItem>> {
  await requireAdminContext();
  const { page, pageSize, from } = pageWindow(filters);
  const status = filterSchema.shape.status.parse(filters.status);
  const term = filters.q?.trim().slice(0, 64) || null;

  const rows =
    unwrap(
      await createAdminClient().rpc("admin_list_customers", {
        p_q: term,
        p_status: status ?? null,
        p_limit: pageSize,
        p_offset: from,
      }),
    ) ?? [];

  return {
    rows: rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      status: row.status,
      createdAt: row.created_at,
      orderCount: row.order_count,
      walletBalanceKobo: row.wallet_balance_kobo,
    })),
    total: rows[0]?.total_count ?? 0,
    page,
    pageSize,
  };
}

export interface UserDetail {
  readonly profile: Tables<"profiles">;
  /** From Supabase Auth; null for a phone-only account. */
  readonly email: string | null;
  /**
   * Whether Supabase Auth currently bans this user from signing in (banned_until
   * in the future). A suspended profile with this false is "sign-in ban pending":
   * a rider finishing a delivery, or a ban call that failed.
   */
  readonly signInBanned: boolean;
  readonly roles: readonly UserRoleView[];
  /** Customer wallet; null until the wallet has been used. */
  readonly wallet: OwnerBalance | null;
  /** Orders this user placed, newest first, last 20. */
  readonly recentOrders: readonly RecentOrderView[];
  /** Newest 20 entries on the customer wallet account; empty until the wallet exists. */
  readonly walletActivity: readonly WalletActivityEntry[];
}

export interface WalletActivityEntry {
  readonly id: string;
  readonly createdAt: string;
  /** credit adds to the wallet, debit spends from it. */
  readonly direction: "debit" | "credit";
  readonly amountKobo: number;
  readonly entryType: string;
  readonly transactionKind: "payment_capture" | "escrow_release" | "payout" | "refund" | "adjustment" | null;
  readonly orderId: string | null;
  readonly orderCode: string | null;
}

// Admin-tier on purpose: wallet balances are already admin-visible (support use); the bulk ledger export is finance-only.
/** Newest ledger entries on the user's customer wallet, resolved in three batched queries (account, transactions, orders). */
async function loadWalletActivity(admin: AdminClient, userId: string, limit = 20): Promise<WalletActivityEntry[]> {
  const account = unwrap(
    await admin.from("accounts").select("id").eq("owner_type", "customer").eq("owner_id", userId).eq("kind", "wallet").maybeSingle(),
  );
  if (!account) return [];

  const entries =
    unwrap(
      await admin
        .from("ledger_entries")
        .select("id, transaction_id, direction, amount_kobo, entry_type, order_id, created_at")
        .eq("account_id", account.id)
        .order("created_at", { ascending: false })
        .limit(limit),
    ) ?? [];
  if (entries.length === 0) return [];

  const transactionIds = distinctIds(entries.map((entry) => entry.transaction_id));
  const transactions = unwrap(await admin.from("transactions").select("id, kind, order_id").in("id", transactionIds)) ?? [];
  const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));

  const orderIdOf = (entry: (typeof entries)[number]) => entry.order_id ?? transactionById.get(entry.transaction_id)?.order_id ?? null;
  const codeByOrder = await loadOrderCodes(admin, entries.map(orderIdOf));

  return entries.map((entry) => {
    const transaction = transactionById.get(entry.transaction_id);
    const orderId = orderIdOf(entry);
    return {
      id: entry.id,
      createdAt: entry.created_at,
      direction: entry.direction,
      amountKobo: entry.amount_kobo,
      entryType: entry.entry_type,
      transactionKind: transaction?.kind ?? null,
      orderId,
      orderCode: orderId ? (codeByOrder.get(orderId) ?? null) : null,
    };
  });
}

function isBanned(bannedUntil: string | null | undefined): boolean {
  return bannedUntil != null && new Date(bannedUntil).getTime() > Date.now();
}

export async function getUserDetail(userId: string): Promise<UserDetail | null> {
  await requireAdminContext();
  if (!z.string().uuid().safeParse(userId).success) return null;
  const admin = createAdminClient();

  const profile = unwrap(await admin.from("profiles").select("*").eq("id", userId).maybeSingle());
  if (!profile) return null;

  const [roles, authUser, wallet, recentOrders, walletActivity] = await Promise.all([
    admin.from("user_roles").select("role, scope_type, scope_id").eq("user_id", userId),
    admin.auth.admin.getUserById(userId),
    loadOwnerBalance(admin, "customer", userId),
    loadRecentOrders(admin, "customer_id", userId),
    loadWalletActivity(admin, userId),
  ]);

  return {
    profile,
    email: authUser.data.user?.email ?? null,
    signInBanned: isBanned(authUser.data.user?.banned_until),
    roles: (unwrap(roles) ?? []).map((row) => ({
      role: row.role,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
    })),
    wallet,
    recentOrders,
    walletActivity,
  };
}
