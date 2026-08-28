import "server-only";
import { getOptionalSession } from "./dal";
import { getActiveRole } from "./active-role";
import { createClient } from "../supabase/server";

export interface MarketingAccount {
  fullName: string;
  avatarUrl: string | null;
  accountHref: string;
}

/**
 * Whether the current visitor is signed in, for the marketing (logged-out)
 * pages' shared Header — returns null rather than redirecting so /,
 * /terms, /privacy, and /support stay reachable to anonymous visitors,
 * unlike verifySession()/requireVendorContext().
 */
export async function getMarketingAccount(): Promise<MarketingAccount | null> {
  const session = await getOptionalSession();
  if (!session) return null;

  const supabase = await createClient();
  const [{ data: profile }, activeRole] = await Promise.all([
    supabase.from("profiles").select("full_name, avatar_url").eq("id", session.userId).single(),
    getActiveRole(),
  ]);

  return {
    fullName: profile?.full_name || session.email || "Account",
    avatarUrl: profile?.avatar_url ?? null,
    accountHref: activeRole === "vendor" ? "/dashboard" : "/profile",
  };
}
