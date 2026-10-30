import "server-only";
import { createAdminClient } from "./supabase/admin";
import { getRefundStatus, initiateRefund, type MonnifyRefundStatus } from "./monnify";

/**
 * What requestMonnifyRefundForOrder() did.
 *  - recorded: Monnify's status for the refund is now on the payment row.
 *  - unknown: the refund was claimed but Monnify's answer could not be
 *    established. It may or may not exist there; check Monnify before doing
 *    anything else.
 *  - already_requested: another call holds the claim; nothing was sent.
 *  - not_applicable: the ledger did not refund this order to the gateway, or
 *    there is no Monnify payment to refund; nothing was sent.
 */
export type GatewayRefundOutcome = "recorded" | "unknown" | "already_requested" | "not_applicable";

/**
 * The second half of a gateway refund: refund_order_escrow(..., 'gateway')
 * reverses KiaKia's own ledger, but Postgres has no HTTP client, so asking
 * Monnify to send the customer's money back happens here, from the Server
 * Action, after that RPC succeeds.
 *
 * Money rules, in order:
 *  1. Only an order whose '<code>-refund' ledger transaction credited
 *     platform:gateway is eligible. A wallet-refunded order has already paid
 *     the customer; a card refund on top would pay them twice.
 *  2. payments.refund_reference is CLAIMED (set, status 'pending') before
 *     Monnify is called, by a conditional update only one caller can win. A
 *     double click or a concurrent retry therefore never sends two requests.
 *  3. A failed call does not release the claim: the request may have reached
 *     Monnify. Its status is looked up by the same refundReference instead and
 *     recorded; if that fails too the row stays 'pending' and the outcome is
 *     'unknown'.
 *
 * Never throws: the order transition and ledger refund have already committed.
 */
export async function requestMonnifyRefundForOrder(orderCode: string): Promise<GatewayRefundOutcome> {
  const admin = createAdminClient();

  const { data: destination } = await admin.rpc("order_refund_destination", { p_order_code: orderCode });
  if (destination !== "gateway") return "not_applicable";

  const { data: payment } = await admin
    .from("payments")
    .select("id, provider_ref, amount_kobo, refund_reference")
    .eq("idempotency_key", orderCode)
    .maybeSingle();

  if (!payment || !payment.provider_ref) return "not_applicable";
  if (payment.refund_reference) return "already_requested";

  // How much to ask for comes from the LEDGER, not the payment row: for a
  // card + wallet order only the card part goes back to the card (the wallet
  // part was returned to the wallet). If the two ever disagree, ask for
  // nothing and say so - a human reconciles it - rather than over- or
  // under-refund the customer's card.
  const { data: ledgerRefundKobo } = await admin.rpc("order_refund_gateway_kobo", { p_order_code: orderCode });
  if (typeof ledgerRefundKobo !== "number" || ledgerRefundKobo <= 0) return "not_applicable";
  if (ledgerRefundKobo > payment.amount_kobo) {
    console.error(
      `requestMonnifyRefundForOrder: order ${orderCode} ledger refund (${ledgerRefundKobo} kobo) exceeds the card payment (${payment.amount_kobo} kobo); not asking Monnify`,
    );
    return "unknown";
  }

  const refundReference = `${orderCode}-refund`;

  const { data: claimed, error: claimError } = await admin
    .from("payments")
    .update({ refund_reference: refundReference, refund_status: "pending" })
    .eq("id", payment.id)
    .is("refund_reference", null)
    .select("id");
  if (claimError) {
    console.error(`requestMonnifyRefundForOrder: could not claim the refund for order ${orderCode}`, claimError);
    return "unknown";
  }
  if (!claimed?.length) return "already_requested";

  try {
    const result = await initiateRefund({
      transactionReference: payment.provider_ref,
      refundReference,
      refundAmountKobo: ledgerRefundKobo,
      refundReason: "Order cancelled",
      customerNote: "KiaKia refund",
    });
    await recordRefundStatus(admin, payment.id, result.refundStatus);
    return "recorded";
  } catch (error) {
    console.error(`requestMonnifyRefundForOrder: Monnify initiate-refund failed for order ${orderCode}`, error);
  }

  try {
    const result = await getRefundStatus(refundReference);
    await recordRefundStatus(admin, payment.id, result.refundStatus);
    return "recorded";
  } catch (error) {
    console.error(`requestMonnifyRefundForOrder: Monnify refund status lookup failed for order ${orderCode}`, error);
    return "unknown";
  }
}

async function recordRefundStatus(
  admin: ReturnType<typeof createAdminClient>,
  paymentId: string,
  status: MonnifyRefundStatus,
): Promise<void> {
  const { error } = await admin.from("payments").update({ refund_status: mapMonnifyRefundStatus(status) }).eq("id", paymentId);
  if (error) console.error(`requestMonnifyRefundForOrder: could not record refund status for payment ${paymentId}`, error);
}

function mapMonnifyRefundStatus(status: MonnifyRefundStatus): "pending" | "completed" | "failed" {
  if (status === "COMPLETED") return "completed";
  if (status === "FAILED") return "failed";
  return "pending"; // PENDING / IN_PROGRESS — still processing at Monnify's end
}
