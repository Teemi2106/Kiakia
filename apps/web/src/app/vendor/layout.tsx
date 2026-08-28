import { redirect } from "next/navigation";
import { getOptionalSession, getRoles, hasRole, VENDOR_ROLES } from "@/lib/auth/dal";
import "../(auth)/auth.css";

export default async function VendorAuthLayout({ children }: { children: React.ReactNode }) {
  // Mirrors (auth)/layout.tsx's "already signed in? skip the form" bounce,
  // but an existing vendor lands on /dashboard while everyone else (a
  // signed-in customer with no vendor role yet) lands on /onboarding —
  // never /home, since these are the vendor entry points.
  //
  // B2 (independent security review): this used to call setActiveRole("vendor")
  // directly here, in a Server Component's render — Next.js 16 throws on a
  // cookie write during render (only Server Actions/Route Handlers may write
  // cookies). Redirecting to /vendor/enter instead: that Route Handler is
  // allowed to write cookies, and delegates to switchToVendorAction() (the
  // same "switch into vendor mode" primitive used everywhere else,
  // app/actions/session.ts) so the cookie write + /dashboard redirect still
  // happens — just from a place Next actually permits it.
  const session = await getOptionalSession();
  if (session) {
    const roles = await getRoles();
    if (hasRole(roles, ...VENDOR_ROLES)) {
      redirect("/vendor/enter");
    }
    redirect("/onboarding");
  }

  // No wrapper element: /vendor/login and /vendor/register render the same
  // full-bleed <AuthShell> as the customer screens, so a centring <main>
  // here would fight it. This layout exists for the guard above and to scope
  // auth.css to these two routes.
  return children;
}
