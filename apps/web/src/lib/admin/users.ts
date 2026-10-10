import "server-only";
import type { Role, Tables } from "@kiakia/db";
import { z } from "zod";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnerBalance, type OwnerBalance } from "./finance";
import { unwrap } from "./lookups";
import { loadRecentOrders, type RecentOrderView } from "./orders";
import { distinctIds, orIlike, pageWindow, searchTerm, type Page, type PageParams } from "./query";

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
  const { page, pageSize, from, to } = pageWindow(filters);
  const parsed = filterSchema.parse(filters);
  const term = searchTerm(filters.q);

  let query = admin
    .from("profiles")
    .select("id, full_name, phone, status, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (term) query = query.or(orIlike(["full_name", "phone"], term));
  if (parsed.status) query = query.eq("status", parsed.status);
  if (parsed.role) {
    const holders = unwrap(await admin.from("user_roles").select("user_id").eq("role", parsed.role)) ?? [];
    query = query.in("id", distinctIds(holders.map((holder) => holder.user_id)));
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const profiles = data ?? [];

  const roleRows = profiles.length
    ? (unwrap(
        await admin
          .from("user_roles")
          .select("user_id, role")
          .in(
            "user_id",
            profiles.map((profile) => profile.id),
          ),
      ) ?? [])
    : [];
  const rolesByUser = new Map<string, Role[]>();
  for (const row of roleRows) rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) ?? []), row.role]);

  return {
    rows: profiles.map((profile) => ({
      id: profile.id,
      fullName: profile.full_name,
      phone: profile.phone,
      status: profile.status,
      roles: [...new Set(rolesByUser.get(profile.id) ?? [])],
      createdAt: profile.created_at,
    })),
    total: count ?? 0,
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

  const [roles, authUser, wallet, recentOrders] = await Promise.all([
    admin.from("user_roles").select("role, scope_type, scope_id").eq("user_id", userId),
    admin.auth.admin.getUserById(userId),
    loadOwnerBalance(admin, "customer", userId),
    loadRecentOrders(admin, "customer_id", userId),
  ]);

  return {
    profile,
    email: authUser.data.user?.email ?? null,
    signInBanned: isBanned(authUser.data.user?.banned_until),
    roles: (unwrap(roles) ?? []).map((row) => ({ role: row.role, scopeType: row.scope_type, scopeId: row.scope_id })),
    wallet,
    recentOrders,
  };
}
