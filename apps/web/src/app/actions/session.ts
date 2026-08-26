"use server";

import { redirect } from "next/navigation";
import { getRoles, hasRole, VENDOR_ROLES, verifySession } from "@/lib/auth/dal";
import { setActiveRole } from "@/lib/auth/active-role";

/**
 * The explicit "switch" the customer/vendor surfaces require before either
 * one becomes reachable — see requireVendorContext() and the (customer)
 * layout's mirror check in lib/auth/dal.ts. Re-checks role membership itself
 * rather than trusting that only a legitimately-eligible UI element could
 * have called it; this is a Server Function, reachable by direct POST.
 */
export async function switchToVendorAction(): Promise<void> {
  const roles = await getRoles();

  if (!hasRole(roles, ...VENDOR_ROLES)) {
    redirect("/onboarding");
  }

  await setActiveRole("vendor");
  redirect("/dashboard");
}

export async function switchToCustomerAction(): Promise<void> {
  await verifySession();
  await setActiveRole("customer");
  redirect("/home");
}
