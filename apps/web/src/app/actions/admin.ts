"use server";

import { revalidatePath } from "next/cache";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestMonnifyRefundForOrder } from "@/lib/monnify-refund";
import { field, rpcFailureMessage, type FormState } from "@/lib/admin/action-helpers";
import { REFUND_STATUS_UNKNOWN } from "@/lib/admin/refund-messages";
import {
  firstIssue,
  optionalReasonSchema,
  reassignOrderRiderSchema,
  refundOrderSchema,
  rejectDocumentSchema,
  uuidSchema,
} from "@/lib/validation/admin";

/**
 * Vendor/rider/document/order review actions. Every RPC here is
 * service_role-only SECURITY DEFINER (0021, 0027, 0031, 0045, 0052, rebuilt
 * with auditing in 0080): requireAdminContext() is this app's authorization
 * boundary and the RPC re-verifies the actor and writes the audit row in the
 * same transaction.
 *
 * Every action returns a FormState rather than throwing: Next redacts the
 * message of an error thrown from a Server Action in production, so the admin
 * would only see a generic failure. One-click approve/reject buttons are bound
 * to an id (`approveVendorAction.bind(null, id)`) and take an optional `reason`
 * field from the form; actions whose input is required (a refund reason, a
 * document rejection note) carry the id in a hidden field.
 */

type ReviewInput = { readonly id: string; readonly reason: string | undefined } | { readonly error: string };

function parseReviewInput(id: string, formData?: FormData): ReviewInput {
  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) return { error: "Invalid id" };
  const parsedReason = optionalReasonSchema.safeParse(formData ? field(formData, "reason") : undefined);
  if (!parsedReason.success) return { error: firstIssue(parsedReason.error) };
  return { id: parsedId.data, reason: parsedReason.data };
}

/** approve_vendor also reinstates a suspended vendor; the reason is optional either way. */
export async function approveVendorAction(vendorId: string, _prevState: FormState, formData?: FormData): Promise<FormState> {
  const session = await requireAdminContext();
  const input = parseReviewInput(vendorId, formData);
  if ("error" in input) return input;

  const { error } = await createAdminClient().rpc("approve_vendor", {
    p_vendor_id: input.id,
    p_actor_id: session.userId,
    p_reason: input.reason,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath("/admin/vendors");
  revalidatePath(`/admin/vendors/${input.id}`);
  return { success: true };
}

export async function rejectVendorAction(vendorId: string, _prevState: FormState, formData?: FormData): Promise<FormState> {
  const session = await requireAdminContext();
  const input = parseReviewInput(vendorId, formData);
  if ("error" in input) return input;

  const { error } = await createAdminClient().rpc("reject_vendor", {
    p_vendor_id: input.id,
    p_actor_id: session.userId,
    p_reason: input.reason,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath("/admin/vendors");
  revalidatePath(`/admin/vendors/${input.id}`);
  return { success: true };
}

export async function approveRiderAction(riderId: string, _prevState: FormState, formData?: FormData): Promise<FormState> {
  const session = await requireAdminContext();
  const input = parseReviewInput(riderId, formData);
  if ("error" in input) return input;

  const { error } = await createAdminClient().rpc("approve_rider", {
    p_rider_id: input.id,
    p_actor_id: session.userId,
    p_reason: input.reason,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath("/admin/riders");
  revalidatePath(`/admin/riders/${input.id}`);
  return { success: true };
}

export async function rejectRiderAction(riderId: string, _prevState: FormState, formData?: FormData): Promise<FormState> {
  const session = await requireAdminContext();
  const input = parseReviewInput(riderId, formData);
  if ("error" in input) return input;

  const { error } = await createAdminClient().rpc("reject_rider", {
    p_rider_id: input.id,
    p_actor_id: session.userId,
    p_reason: input.reason,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath("/admin/riders");
  revalidatePath(`/admin/riders/${input.id}`);
  return { success: true };
}

/**
 * approve_rider_document does not touch riders.kyc_status: approving each
 * document and approving the rider are separate admin decisions (0052).
 */
export async function approveRiderDocumentAction(documentId: string, _prevState: FormState): Promise<FormState> {
  const session = await requireAdminContext();
  const id = uuidSchema.safeParse(documentId);
  if (!id.success) return { error: "Invalid id" };

  const { data: document, error } = await createAdminClient().rpc("approve_rider_document", {
    p_document_id: id.data,
    p_actor_id: session.userId,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath("/admin/riders");
  if (document) revalidatePath(`/admin/riders/${document.rider_id}`);
  return { success: true };
}

/** The note is shown to the rider in the rider app, so it is required. */
export async function rejectRiderDocumentAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdminContext();

  const parsed = rejectDocumentSchema.safeParse({
    documentId: field(formData, "documentId"),
    note: field(formData, "note"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { data: document, error } = await createAdminClient().rpc("reject_rider_document", {
    p_document_id: parsed.data.documentId,
    p_actor_id: session.userId,
    p_note: parsed.data.note,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath("/admin/riders");
  if (document) revalidatePath(`/admin/riders/${document.rider_id}`);
  return { success: true };
}

/**
 * Reverses capture_payment()'s ledger entries for an order whose escrow has
 * not been released; the RPC refuses outright if it has, so a stale admin UI
 * cannot refund and pay out the same order. "wallet" (the default) is instant
 * and complete: the customer's KiaKia wallet is credited from escrow. "gateway"
 * only reverses KiaKia's own ledger — Postgres has no HTTP client — so the
 * actual request to Monnify happens right after, here. It is best-effort and
 * claim-before-call (see requestMonnifyRefundForOrder). If the ledger refund
 * already went to the other destination the RPC refuses, so one order is never
 * refunded to both. A Monnify outcome that cannot be established is reported
 * as an error even though the ledger refund stands: the admin must check
 * Monnify, not retry.
 */
export async function refundOrderEscrowAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdminContext();

  const parsed = refundOrderSchema.safeParse({
    orderId: field(formData, "orderId"),
    reason: field(formData, "reason"),
    destination: field(formData, "destination") ?? "wallet",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { data: order, error } = await createAdminClient().rpc("refund_order_escrow", {
    p_order_id: parsed.data.orderId,
    p_actor_id: session.userId,
    p_reason: parsed.data.reason,
    p_destination: parsed.data.destination,
  });
  if (error) return { error: rpcFailureMessage(error) };

  // A wallet refund is already complete — asking Monnify too would refund
  // the same order twice.
  const monnifyOutcome =
    parsed.data.destination === "gateway" && order ? await requestMonnifyRefundForOrder(order.code) : null;

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  if (monnifyOutcome === "unknown") return { error: REFUND_STATUS_UNKNOWN };
  return { success: true };
}

/**
 * Dispatch override (0083) for an order nobody has picked up yet. A blank
 * `riderId` takes the current rider off and offers the order afresh; a rider id
 * forces that rider onto it (the RPC checks they are approved, online, recent
 * and free, and quotes their fee). The previous rider is read first, only so
 * their page can be revalidated: the RPC decides what actually happens.
 */
export async function reassignOrderRiderAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdminContext();

  const parsed = reassignOrderRiderSchema.safeParse({
    orderId: field(formData, "orderId"),
    riderId: field(formData, "riderId"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const admin = createAdminClient();
  const { data: before } = await admin.from("orders").select("rider_id").eq("id", parsed.data.orderId).maybeSingle();

  const { data: order, error } = await admin.rpc("admin_reassign_order_rider", {
    p_order_id: parsed.data.orderId,
    p_rider_id: parsed.data.riderId ?? null,
    p_reason: parsed.data.reason,
    p_actor_id: session.userId,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  for (const riderId of new Set([before?.rider_id, order?.rider_id])) {
    if (riderId) revalidatePath(`/admin/riders/${riderId}`);
  }
  return { success: true };
}

/**
 * Clears the delivery-code lockout (0022/0025) for an order stuck at
 * 'arrived' after a legitimate support call. Writes an admin-authored
 * order_events marker; it does not touch arrived_at or any existing event.
 */
export async function resetDeliveryCodeAttemptsAction(orderId: string, _prevState: FormState, formData?: FormData): Promise<FormState> {
  const session = await requireAdminContext();
  const input = parseReviewInput(orderId, formData);
  if ("error" in input) return input;

  const { error } = await createAdminClient().rpc("admin_reset_delivery_code_attempts", {
    p_order_id: input.id,
    p_actor_id: session.userId,
    p_reason: input.reason,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${input.id}`);
  return { success: true };
}
