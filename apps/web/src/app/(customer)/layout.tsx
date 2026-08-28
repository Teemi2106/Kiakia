// app/(customer)/layout.tsx
import { redirect } from "next/navigation";
import { CustomerBottomNav } from "./_components/CustomerBottomNav";
import { CustomerTopNav } from "./_components/CustomerTopNav";
import { CartProvider } from "./cart/_components/CartProvider";
import { getRoles, hasRole, verifySession, VENDOR_ROLES } from "@/lib/auth/dal";
import { getActiveRole } from "@/lib/auth/active-role";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Session verification stays on the server
  await verifySession();

  const roles = await getRoles();
  const canSwitchToVendor = hasRole(roles, ...VENDOR_ROLES);

  // Mirror image of requireVendorContext(): a session actively in vendor
  // mode doesn't land in the customer surface just by typing /home — it
  // has to switch back via switchToCustomerAction first.
  //
  // S3 (independent security review): this used to bounce on
  // getActiveRole() === "vendor" alone, before checking roles. If the
  // session's kk_active_role cookie is "vendor" but the account no longer
  // holds a vendor role (role revoked, or a stale cookie from
  // vendorLoginAction sending a non-vendor account to /onboarding without
  // resetting it — see auth.ts), this bounced to /dashboard, which
  // requireVendorContext() then bounced right back to /home — an infinite
  // redirect loop. Only bounce when the session BOTH holds a vendor role
  // AND is actually in vendor mode.
  if (canSwitchToVendor && (await getActiveRole()) === "vendor") {
    redirect("/dashboard");
  }

  return (
    <CartProvider>
      {/* CustomerTopNav is `fixed` and CustomerBottomNav is `fixed`, so
          neither takes up space in the flow — <main> has to be inset by both
          or they sit on top of the page. That offset lives here, once, rather
          than being re-derived as a magic `pt-` on every customer page: it
          was missing from all of them except /home (which had a pt-20 that
          was right for the desktop bar and ~50px short of the stacked mobile
          one), so the first line of most screens rendered underneath the
          header.

          --kk-nav-h must equal CustomerTopNav's real height: 56px identity
          row + 84px address/search row + 1px border below `lg`, and a single
          72px row + 1px border at `lg` and up. --kk-tabbar-h matches
          BottomNav's h-16, which disappears at the same `lg` breakpoint. */}
      <div className="flex min-h-screen flex-col bg-kk-cream [--kk-nav-h:141px] [--kk-tabbar-h:4rem] lg:[--kk-nav-h:73px] lg:[--kk-tabbar-h:0px]">
        <CustomerTopNav canSwitchToVendor={canSwitchToVendor} />
        <main className="flex-1 pt-(--kk-nav-h) pb-(--kk-tabbar-h)">{children}</main>
        <CustomerBottomNav />
      </div>
    </CartProvider>
  );
}
