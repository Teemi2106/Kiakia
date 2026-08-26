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

/**
 * approve_rider(p_rider_id, p_actor_id) / reject_rider(p_rider_id, p_actor_id)
 * — SECURITY DEFINER RPCs (supabase/migrations/0027_rider_kyc_admin_approval.sql),
 * grantable to service_role only, mirroring approveVendorAction/
 * rejectVendorAction above exactly (same requireAdminContext()-then-
 * createAdminClient() shape, same reasoning for why the Server Action's own
 * check is the real authorization boundary here, not just the RPC's).
 */
export async function approveRiderAction(riderId: string): Promise<void> {
  const session = await requireAdminContext();
  const admin = createAdminClient();

  const { error } = await admin.rpc("approve_rider", {
    p_rider_id: riderId,
    p_actor_id: session.userId,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/riders");
}

export async function rejectRiderAction(riderId: string): Promise<void> {
  const session = await requireAdminContext();
  const admin = createAdminClient();

  const { error } = await admin.rpc("reject_rider", {
    p_rider_id: riderId,
    p_actor_id: session.userId,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/riders");
}

/**
 * refund_order_escrow(p_order_id, p_actor_id, p_reason) —
 * SECURITY DEFINER RPC (supabase/migrations/0031_refund_and_escrow_unwind.sql),
 * grantable to service_role only, mirroring approveVendorAction/
 * rejectVendorAction above exactly (same requireAdminContext()-then-
 * createAdminClient() shape). Reverses capture_payment()'s ledger entries
 * for an order whose escrow has not yet been released; refuses outright
 * (surfaced here as a thrown Error) if it already has been, so no double
 * payout is possible even if this action is invoked more than once from a
 * stale admin UI.
 */
export async function refundOrderEscrowAction(orderId: string, reason: string): Promise<void> {
  const session = await requireAdminContext();
  const admin = createAdminClient();

  const { error } = await admin.rpc("refund_order_escrow", {
    p_order_id: orderId,
    p_actor_id: session.userId,
    p_reason: reason,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/orders");
}

/**
 * admin_reset_delivery_code_attempts(p_order_id, p_actor_id) —
 * SECURITY DEFINER RPC (supabase/migrations/0031_refund_and_escrow_unwind.sql),
 * grantable to service_role only, mirroring approveVendorAction above
 * exactly. Clears the delivery-code failed-attempt lockout (0022/0025) for
 * an order stuck at 'arrived' after a legitimate support call — it does
 * not touch order_events (append-only) or arrived_at (customer-visible),
 * only records a reset marker that verify_delivery_and_release_escrow()
 * now honors as the start of a fresh rate-limit window.
 */
export async function resetDeliveryCodeAttemptsAction(orderId: string): Promise<void> {
  const session = await requireAdminContext();
  const admin = createAdminClient();

  const { error } = await admin.rpc("admin_reset_delivery_code_attempts", {
    p_order_id: orderId,
    p_actor_id: session.userId,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/orders");
}
