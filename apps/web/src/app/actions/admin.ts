"use server";

import { revalidatePath } from "next/cache";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * approve_vendor(p_vendor_id, p_actor_id) / reject_vendor(p_vendor_id, p_actor_id)
 * — SECURITY DEFINER RPCs, grantable to service_role only (never
 * `authenticated`), per the contract this was built against. Called via
 * createAdminClient() because that grant means the user-scoped client
 * can't reach them at all.
 *
 * requireAdminContext() here is the real authorization boundary from this
 * app's side — the RPC re-verifying p_actor_id is a genuine admin is
 * defense-in-depth, not a reason for this Server Action to skip its own
 * check (same pattern as every other privileged write in this codebase,
 * e.g. advanceOrderAction / transition_order). Bound via
 * `approveVendorAction.bind(null, vendorId)` from a plain
 * `<form action=...}>`, so this returns Promise<void> — errors throw,
 * surfaced by (admin)/error.tsx, same shape as advanceOrderAction /
 * retryPaymentAction in app/actions/orders.ts.
 */
export async function approveVendorAction(vendorId: string): Promise<void> {
  const session = await requireAdminContext();
  const admin = createAdminClient();

  const { error } = await admin.rpc("approve_vendor", {
    p_vendor_id: vendorId,
    p_actor_id: session.userId,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/vendors");
}

export async function rejectVendorAction(vendorId: string): Promise<void> {
  const session = await requireAdminContext();
  const admin = createAdminClient();

  const { error } = await admin.rpc("reject_vendor", {
    p_vendor_id: vendorId,
    p_actor_id: session.userId,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/vendors");
}
