import "server-only";
import { cookies } from "next/headers";

export type ActiveRole = "customer" | "vendor";

const ACTIVE_ROLE_COOKIE = "kk_active_role";

/**
 * Which surface (customer or vendor) this browser session is currently in.
 * Independent of which roles the account holds — holding a vendor role only
 * grants the *ability* to switch into vendor mode (see switchToVendorAction
 * in app/actions/session.ts); it doesn't put the session there automatically.
 * Defaults to "customer" when unset, so a fresh login or an account that has
 * never switched never lands in vendor mode by accident.
 */
export async function getActiveRole(): Promise<ActiveRole> {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_ROLE_COOKIE)?.value === "vendor"
    ? "vendor"
    : "customer";
}

export async function setActiveRole(role: ActiveRole): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ROLE_COOKIE, role, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/**
 * Clears the active-role cookie entirely (rather than resetting it to
 * "customer", which would still be a value someone could inspect/rely on)
 * — called on sign-out so a shared device doesn't retain vendor mode
 * across different accounts logging in afterwards. getActiveRole()'s
 * default-to-"customer"-when-unset behavior means a cleared cookie is
 * indistinguishable from a fresh session, which is exactly the safe state
 * to sign out into.
 */
export async function clearActiveRole(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ROLE_COOKIE);
}
