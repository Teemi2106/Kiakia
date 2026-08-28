import "server-only";
import { createAdminClient } from "./supabase/admin";
import { initiateRefund, type MonnifyRefundStatus } from "./monnify";

/**
 * The second half of the auto-refund flow: 0041/0043's SQL side already
 * reverses KiaKia's own ledger the instant an order is rejected/cancelled
 * (transition_order() -> _unwind_order_escrow_ledger()), but Postgres has
 * no HTTP client — it can never actually ask Monnify to send the customer's
 * money back. This is that missing call, made from the app layer right
 * after a Server Action's transition_order()/refund_order_escrow() RPC call
 * succeeds (see advanceOrderAction and refundOrderEscrowAction).
 *
 * Best-effort by design: never throws past this function. By the time this
 * runs, the order's status transition has ALREADY committed — a Monnify
 * failure here must not (and structurally cannot, since it's called after
 * the fact) undo that. A failure just leaves `payments.refund_reference`
 * unset, so a later retry of this same function tries again instead of
 * silently giving up forever.
 *
 * Idempotent two ways: `payments.refund_reference` being already set means
 * this order has already been asked about (skip, don't ask Monnify twice
 * from our side), and even if that check somehow raced, Monnify's own API
 * is keyed on the same "<order.code>-refund" refundReference every time, so
 * a duplicate call should surface as a duplicate/rejection at their end
 * rather than a second real refund.
 */
export async function requestMonnifyRefundForOrder(orderCode: string): Promise<void> {
  const admin = createAdminClient();

  const { data: payment } = await admin
    .from("payments")
    .select("id, provider_ref, amount_kobo, refund_reference")
    .eq("idempotency_key", orderCode)
    .maybeSingle();

  // No payment row, or it never actually reached Monnify (no provider_ref
  // yet) — nothing was ever captured, so there's nothing to send back.
  if (!payment || !payment.provider_ref) return;
  // Already asked Monnify for this order — never ask twice from our side.
  if (payment.refund_reference) return;

  const refundReference = `${orderCode}-refund`;

  try {
    const result = await initiateRefund({
      transactionReference: payment.provider_ref,
      refundReference,
      refundAmountKobo: payment.amount_kobo,
      refundReason: "Order cancelled",
      customerNote: "KiaKia refund",
    });

    await admin
      .from("payments")
      .update({
        refund_reference: refundReference,
        refund_status: mapMonnifyRefundStatus(result.refundStatus),
      })
      .eq("id", payment.id);
  } catch (error) {
    // Network/API failure — refund_reference stays null, so a future call
    // to this function for the same order will try again rather than
    // treating this as "already asked".
    console.error(`requestMonnifyRefundForOrder: Monnify initiate-refund failed for order ${orderCode}`, error);
  }
}

function mapMonnifyRefundStatus(status: MonnifyRefundStatus): "pending" | "completed" | "failed" {
  if (status === "COMPLETED") return "completed";
  if (status === "FAILED") return "failed";
  return "pending"; // PENDING / IN_PROGRESS — still processing at Monnify's end
}
