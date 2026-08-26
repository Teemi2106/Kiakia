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
      <div className="flex min-h-screen flex-col bg-[#FCF9F8]">
        <CustomerTopNav canSwitchToVendor={canSwitchToVendor} />
        <main className="flex-1">{children}</main>
        <CustomerBottomNav />
      </div>
    </CartProvider>
  );
}
