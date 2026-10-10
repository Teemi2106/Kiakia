"use server";

import { revalidatePath } from "next/cache";
import { requireAdminContext, requireFinanceContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestMonnifyRefundForOrder } from "@/lib/monnify-refund";
import { field, rpcFailureMessage, type FormState } from "@/lib/admin/action-helpers";
import { REFUND_NOT_SENT, REFUND_STATUS_UNKNOWN } from "@/lib/admin/refund-messages";
import { firstIssue, gatewayRefundSchema, recordPayoutSchema } from "@/lib/validation/admin";

/**
 * Records a manual bank transfer that has ALREADY been made: this moves no
 * money, it books the debit against the vendor's or rider's available balance
 * so the ledger and get_rider_earnings() reflect what was paid. The admin
 * enters naira; it is converted to kobo once, in the schema.
 *
 * Idempotent on the bank reference: resubmitting the same form (a double
 * click, a retry after a timeout) returns the existing transaction instead of
 * paying twice, and the same reference with a different owner or amount is
 * rejected by the RPC. Restricted to superadmins and admins holding the finance
 * role.
 */
export async function recordPayoutAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireFinanceContext();

  const parsed = recordPayoutSchema.safeParse({
    ownerType: field(formData, "ownerType"),
    ownerId: field(formData, "ownerId"),
    amountKobo: field(formData, "amountNaira"),
    externalReference: field(formData, "externalReference"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { error } = await createAdminClient().rpc("admin_record_payout", {
    p_owner_type: parsed.data.ownerType,
    p_owner_id: parsed.data.ownerId,
    p_amount_kobo: parsed.data.amountKobo,
    p_external_reference: parsed.data.externalReference,
    p_reason: parsed.data.reason ?? null,
    p_actor_id: session.userId,
  });
  if (error) {
    return { error: error.code === "23505" ? "That bank reference was already used for a different payout." : rpcFailureMessage(error) };
  }

  revalidatePath("/admin/finance");
  revalidatePath(`/admin/${parsed.data.ownerType === "vendor" ? "vendors" : "riders"}/${parsed.data.ownerId}`);
  return { success: true };
}

/**
 * Makes the Monnify refund call for an order whose ledger refund went to the
 * gateway but which has never been claimed (payments.refund_reference still
 * null). The RPC checks that from the ledger and audits the attempt;
 * requestMonnifyRefundForOrder() then claims and makes the call. That function
 * swallows failures by design, so the outcome it returns decides the message.
 */
export async function requestGatewayRefundAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdminContext();

  const parsed = gatewayRefundSchema.safeParse({
    orderId: field(formData, "orderId"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const admin = createAdminClient();

  const { data: orderCode, error } = await admin.rpc("admin_request_gateway_refund", {
    p_order_id: parsed.data.orderId,
    p_reason: parsed.data.reason ?? null,
    p_actor_id: session.userId,
  });
  if (error || !orderCode) return { error: error ? rpcFailureMessage(error) : "Something went wrong. Please try again." };

  const outcome = await requestMonnifyRefundForOrder(orderCode);

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);

  if (outcome === "unknown") return { error: REFUND_STATUS_UNKNOWN };
  if (outcome !== "recorded") return { error: REFUND_NOT_SENT };
  return { success: true };
}
