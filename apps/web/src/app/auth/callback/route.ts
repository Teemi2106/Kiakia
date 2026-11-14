import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/safe-next";
import { setActiveRole } from "@/lib/auth/active-role";
import { createClient } from "@/lib/supabase/server";

const VENDOR_ROLES = new Set(["vendor_staff", "vendor_manager", "vendor_owner"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const intent = url.searchParams.get("intent") === "vendor" ? "vendor" : "customer";
  const next = safeNextPath(url.searchParams.get("next"));
  const failurePath = intent === "vendor" ? "/vendor/login?oauth_error=google" : "/login?oauth_error=google";
  const code = url.searchParams.get("code");

  if (!code || url.searchParams.has("error")) redirect(failurePath);

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    console.error("[auth] Google OAuth callback failed", { code: exchangeError.code });
    redirect(failurePath);
  }

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || typeof userId !== "string") {
    await supabase.auth.signOut();
    redirect(failurePath);
  }

  const { data: roleRows, error: rolesError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (rolesError) {
    await supabase.auth.signOut();
    redirect(failurePath);
  }

  const hasVendorRole = (roleRows ?? []).some((row) => VENDOR_ROLES.has(row.role));
  const isRiderOnly = (roleRows ?? []).some((row) => row.role === "rider") && !hasVendorRole;
  if (isRiderOnly) {
    await supabase.auth.signOut();
    redirect(failurePath);
  }

  if (intent === "vendor" && !hasVendorRole) {
    await setActiveRole("customer");
    redirect("/onboarding");
  }

  if (hasVendorRole) {
    await setActiveRole("vendor");
    redirect("/dashboard");
  }

  await setActiveRole("customer");
  redirect(next ?? "/home");
}
