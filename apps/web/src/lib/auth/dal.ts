import "server-only";
import type { Role, VendorRow } from "@kiakia/db";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "../supabase/server";
import { getActiveRole } from "./active-role";

/**
 * Data Access Layer — the single place every Server Action and every
 * server-side data read starts from. Mirrors the Next.js authentication
 * guide's DAL pattern exactly, which is also the architecture doc's own
 * rule restated: "the client may read through RLS. The client may never
 * write anything that touches money, order status, or rider assignment.
 * Every such write goes through a Server Action or an RPC that re-derives
 * the values server-side." (§5)
 *
 * Server Functions are reachable by direct POST request, not just through
 * this app's UI — every Server Action must call verifySession() (or
 * requireRole()) itself, not rely on a layout having already redirected.
 * A `return null` in a layout does not protect a Server Action.
 */

export interface Session {
  readonly userId: string;
  readonly email: string | null;
  readonly phone: string | null;
}

/**
 * Same as verifySession() but returns null instead of redirecting when
 * there's no session — for the handful of places that need to branch on
 * "logged in or not" without forcing a redirect, e.g. the (auth) layout
 * bouncing an already-logged-in user away from /login.
 *
 * Identity comes from `getClaims()`, which verifies the access token's
 * signature locally against cached signing keys, so it costs no Auth round
 * trip (`getUser()` was one on every render). The tradeoff is that a token
 * revoked server-side stays valid until it expires (an hour by default).
 * That is why every privileged gate below also reads profiles.status from the
 * database (isActiveAccount()) instead of trusting the token alone, and why
 * RLS and the Server Action re-checks, not this identity, decide what a
 * caller may touch. Wrapped in React's `cache()` so repeated calls within one
 * render pass cost one verification, not N.
 */
export const getOptionalSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) return null;

  return { userId: claims.sub, email: claims.email ?? null, phone: claims.phone ?? null };
});

/** Verifies the session (see getOptionalSession()), redirecting to /login if there is none. */
export const verifySession = cache(async (): Promise<Session> => {
  const session = await getOptionalSession();

  if (!session) {
    redirect("/login");
  }

  return session;
});

/** Returns the caller's own role assignments (readable via RLS — §5's "own rows"). */
export const getRoles = cache(async (): Promise<readonly Role[]> => {
  const session = await verifySession();
  const supabase = await createClient();
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", session.userId);

  if (error) {
    // Fail closed: an unreadable roles table means "no roles", not "let it through".
    return [];
  }

  return data.map((row) => row.role);
});

export function hasRole(roles: readonly Role[], ...allowed: readonly Role[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

/** The role bundle that grants access to the (vendor) dashboard route group. */
export const VENDOR_ROLES = ["vendor_staff", "vendor_manager", "vendor_owner"] as const satisfies readonly Role[];

/**
 * True for an account that holds the rider role and no vendor role.
 *
 * Every signup auto-provisions a 'customer' user_roles row regardless of
 * intent (0002_identity.sql's on-signup trigger) — a rider's account holds
 * 'customer' too, purely as that trigger's side effect, never as a real
 * signal the account holder is meant to shop. So 'customer' is deliberately
 * excluded from this check: a "pure rider" is judged only on rider-vs-vendor,
 * the two roles an account can legitimately hold on purpose. An account that
 * is a rider AND also holds a real vendor role (a vendor owner who also
 * rides, same as this app's own shared test account) is not pure and keeps
 * its web access — only an account with no other reason to be here is
 * turned away, and neither is an admin who also rides (the admin dashboard
 * is a web surface). Used by loginAction/vendorLoginAction to keep KiaKia
 * Rider account holders off the web app entirely, which has no rider-facing
 * surface for them to reach anyway.
 */
export function isPureRider(roles: readonly Role[]): boolean {
  return hasRole(roles, "rider") && !hasRole(roles, ...VENDOR_ROLES, ...ADMIN_ROLES);
}

/**
 * Verifies the session AND that it holds at least one of `allowed` roles,
 * redirecting to `redirectTo` otherwise. Use at the top of every
 * (vendor)/* layout, page, and Server Action that vendor staff reach —
 * this is the optimistic-plus-real check pairing described in the Next.js
 * auth guide: proxy.ts already bounced unauthenticated users before this
 * ever runs; this is the check that actually gates access.
 */
export async function requireRole(allowed: readonly Role[], redirectTo = "/"): Promise<Session> {
  const session = await verifySession();
  const roles = await getRoles();

  if (!hasRole(roles, ...allowed)) {
    redirect(redirectTo);
  }

  return session;
}

/**
 * Gates the (vendor) route group. Holding a vendor role is necessary but not
 * sufficient — the session must also have explicitly switched into vendor
 * mode (see lib/auth/active-role.ts), so a customer who also owns a store
 * doesn't land in the vendor dashboard just by holding the role; they have
 * to switch into it via switchToVendorAction, same as the (customer) group
 * bounces a session that's actively in vendor mode over to /dashboard.
 *
 * The account must also be active. A suspended vendor goes to "/", not
 * `redirectTo`: with vendor mode still on in their cookie, /home bounces them
 * back to /dashboard and /vendor/login on to /vendor/enter and /dashboard, so
 * either would loop. "/" is the one public page that never redirects a session.
 */
export async function requireVendorContext(redirectTo = "/home"): Promise<Session> {
  const session = await verifySession();

  // Three independent reads (roles and profile status are database round trips,
  // the active-role cookie is local), so one wave rather than a chain. The
  // checks below still run in the same order, so which redirect wins is unchanged.
  const [roles, activeRole, active] = await Promise.all([getRoles(), getActiveRole(), isActiveAccount()]);

  if (!hasRole(roles, ...VENDOR_ROLES)) {
    redirect(redirectTo);
  }

  if (activeRole !== "vendor") {
    redirect(redirectTo);
  }

  if (!active) {
    redirect("/");
  }

  return session;
}

/** The role bundle that grants access to the (admin) route group. */
export const ADMIN_ROLES = ["admin", "superadmin"] as const satisfies readonly Role[];

/**
 * Roles granted platform-wide. Admin authority never comes from a vendor-scoped
 * user_roles row (scope_type 'vendor', 0014), so the admin gates read these,
 * not getRoles().
 */
const getPlatformRoles = cache(async (): Promise<readonly Role[]> => {
  const session = await verifySession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", session.userId)
    .eq("scope_type", "platform");

  if (error) return [];

  return data.map((row) => row.role);
});

/**
 * Whether the caller's profile is 'active'. Suspension sets profiles.status and
 * revokes the user's auth sessions, but an access token issued before that
 * stays cryptographically valid until it expires, so privileged entry points
 * check the status too. Fails closed: an unreadable profile is not active.
 */
const isActiveAccount = cache(async (): Promise<boolean> => {
  const session = await verifySession();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("status").eq("id", session.userId).maybeSingle();
  return data?.status === "active";
});

/**
 * Gates a customer-side Server Action on an active account. Customer actions
 * have no requireRole() bundle to hang this on (every signed-in user is a
 * customer), so they call this directly after verifySession(). Redirects to
 * "/" for the same reason requireVendorContext() does: it's the one public
 * page that never redirects a session, so it can't loop.
 */
export async function requireActiveAccount(redirectTo = "/"): Promise<void> {
  if (!(await isActiveAccount())) {
    redirect(redirectTo);
  }
}

/**
 * Gates the (admin) route group. Unlike (vendor), there's no explicit
 * "active mode" concept for admin — holding an admin/superadmin role on an
 * active account is itself sufficient, no mode-switch cookie to layer on top.
 * Same redirect-if-absent shape as requireRole()/requireVendorContext() so
 * every Server Action under app/actions/admin.ts can call this on its own,
 * without trusting that (admin)/layout.tsx already checked.
 */
export async function requireAdminContext(redirectTo = "/home"): Promise<Session> {
  const session = await verifySession();

  // Platform roles and profile status are independent database reads: one
  // wave, not two in a row. Both must pass; neither result is trusted alone.
  const [platformRoles, active] = await Promise.all([getPlatformRoles(), isActiveAccount()]);

  if (!hasRole(platformRoles, ...ADMIN_ROLES) || !active) {
    redirect(redirectTo);
  }

  return session;
}

/** Roles that may change money-shaping settings: commissions, fees and payouts. */
export const FINANCE_ROLES = ["finance", "superadmin"] as const satisfies readonly Role[];

/**
 * requireAdminContext() plus a finance role. The 'finance' role alone does not
 * open the admin dashboard: it only widens what an admin may do, and
 * _assert_admin_actor(..., 'finance') in the database enforces the same rule.
 */
export async function requireFinanceContext(redirectTo = "/admin"): Promise<Session> {
  const session = await requireAdminContext();

  if (!hasRole(await getPlatformRoles(), ...FINANCE_ROLES)) {
    redirect(redirectTo);
  }

  return session;
}

/** Whether the current session may use the finance-gated admin controls. Display only; see requireFinanceContext(). */
export const canManageFinance = cache(async (): Promise<boolean> => hasRole(await getPlatformRoles(), ...FINANCE_ROLES));

/**
 * Whether the current session holds `superadmin`, for UI gating (e.g. showing
 * the admin-role controls). Display only: admin_set_platform_role() and
 * admin_set_user_status() re-check the actor's superadmin role in SQL, so a
 * forged request gains nothing from this returning true.
 */
export const isSuperadmin = cache(async (): Promise<boolean> => hasRole(await getPlatformRoles(), "superadmin"));

export interface FleetMembership {
  readonly fleetId: string;
  readonly fleetName: string;
}

/**
 * The fleet (rider management company) the signed-in user manages, or null.
 * Read with the user's OWN JWT through the "read own fleet membership" and
 * "managers read their fleet" policies (0113), so it fails closed: a missing
 * row, an unreadable table or a suspended fleet all mean "not a fleet manager".
 * The fleet id used for every console query comes from here, never from a
 * request parameter.
 */
export const getFleetMembership = cache(async (): Promise<FleetMembership | null> => {
  const session = await verifySession();
  const supabase = await createClient();
  const { data: membership } = await supabase.from("fleet_managers").select("fleet_id").eq("user_id", session.userId).maybeSingle();
  if (!membership) return null;

  const { data: fleet } = await supabase.from("fleets").select("id, name, status").eq("id", membership.fleet_id).maybeSingle();
  if (!fleet || fleet.status !== "active") return null;

  return { fleetId: fleet.id, fleetName: fleet.name };
});

/**
 * Gates the (fleet) route group and every fleet Server Action: the caller must
 * manage an active fleet and hold an active account. Like admin there is no
 * mode switch; membership itself is the credential. Returns the fleet so
 * callers scope everything to it.
 */
export async function requireFleetContext(redirectTo = "/home"): Promise<{ session: Session; fleet: FleetMembership }> {
  const session = await verifySession();
  const [fleet, active] = await Promise.all([getFleetMembership(), isActiveAccount()]);

  if (!fleet || !active) {
    redirect(redirectTo);
  }

  return { session, fleet };
}

/**
 * Looks up the single vendor the current session's user staffs (§ this
 * plan's "one vendor per account in this release" — register_vendor()
 * enforces the same limit at write time). `cache()`-wrapped so the
 * (vendor) layout and every page under it share one query per request
 * instead of each re-fetching it — every vendor page needs this.
 */
export const getVendorForCurrentUser = cache(async (): Promise<VendorRow | null> => {
  const session = await verifySession();
  const supabase = await createClient();

  // One round trip, not two: an inner join through vendor_staff, filtered to the
  // caller's own membership row (still read under RLS, "staff read own
  // membership"). The generated types carry no relationships, so the embed is
  // untyped here; the row is the plain vendors row plus the join's filter column.
  const { data } = await supabase
    .from("vendors")
    .select("*, vendor_staff!inner(user_id)")
    .eq("vendor_staff.user_id", session.userId)
    .maybeSingle();

  if (!data) return null;

  const { vendor_staff: _membership, ...vendor } = data as unknown as VendorRow & { vendor_staff: unknown };
  void _membership;
  return vendor;
});
