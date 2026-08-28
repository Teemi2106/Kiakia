import "server-only";
import type { Database } from "@kiakia/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "How much of this vendor's money is currently sitting in escrow, not yet
 * released to them?" — shown on the dashboard ("Escrow Pending") and the
 * earnings page ("Pending"/"Pending Payout").
 *
 * There is no per-vendor `escrow` (or `pending_payout`) ledger account
 * anywhere in this schema — capture_payment() (0010_capture_payment.sql)
 * only ever credits the platform's single pooled `platform:escrow` account,
 * shared across every vendor's in-flight orders. The vendor only gets an
 * `accounts` row of their own (`kind = 'available'`) lazily, the first time
 * verify_delivery_and_release_escrow() (0020) actually releases a payout to
 * them. Both dashboard pages used to read a vendor-scoped `kind = 'escrow'`
 * (or `'pending_payout'`) account that this design never creates or
 * credits, so they always showed ₦0.00 regardless of how many paid orders
 * were in flight.
 *
 * This derives the same number honestly instead: sum, over this vendor's
 * own captured-but-not-yet-resolved orders, of the vendor's share
 * (subtotal_kobo minus commission — exactly verify_delivery_and_release_escrow()'s
 * own v_vendor_kobo formula, kept in sync with it). "Not yet resolved" means
 * neither a "<code>-escrow" transaction (0020 — released to vendor/rider/
 * platform on delivery) nor a "<code>-refund" transaction (0031 —
 * unwound back to the customer by an admin) exists yet for that order.
 *
 * `transactions` has ALL privileges revoked from `authenticated`
 * (0007_rls.sql) — hence the separate admin client param, same reasoning as
 * both call sites' own header comments for `accounts`/`ledger_entries`.
 */
export async function computeVendorPendingEscrowKobo(
  ordersClient: SupabaseClient<Database>,
  adminClient: SupabaseClient<Database>,
  vendorId: string,
  commissionBps: number,
): Promise<number> {
  const { data: paidOrders } = await ordersClient
    .from("orders")
    .select("code, subtotal_kobo")
    .eq("vendor_id", vendorId)
    .eq("payment_status", "paid");

  if (!paidOrders || paidOrders.length === 0) return 0;

  const references = paidOrders.flatMap((order) => [`${order.code}-escrow`, `${order.code}-refund`]);
  const { data: resolvedTransactions } = await adminClient
    .from("transactions")
    .select("reference")
    .in("reference", references);

  const resolvedCodes = new Set(
    (resolvedTransactions ?? []).map((t) => t.reference.replace(/-(escrow|refund)$/, "")),
  );

  return paidOrders
    .filter((order) => !resolvedCodes.has(order.code))
    .reduce((sum, order) => {
      const commissionKobo = Math.round((order.subtotal_kobo * commissionBps) / 10000);
      return sum + (order.subtotal_kobo - commissionKobo);
    }, 0);
}
