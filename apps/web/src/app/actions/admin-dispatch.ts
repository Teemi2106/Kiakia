"use server";

import { revalidatePath } from "next/cache";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { field, rpcFailureMessage, type FormState } from "@/lib/admin/action-helpers";
import { parseRedispatchResult, redispatchMessage } from "@/lib/admin/dispatch-info";
import { firstIssue, redispatchOrderSchema, setDispatchSettingSchema } from "@/lib/validation/admin";

/**
 * TODO(0097): admin_set_dispatch_setting / admin_redispatch_order are not in
 * packages/db's generated types until migration 0097 lands. Calls go through
 * this narrow cast; remove it (and call admin.rpc directly) once they are.
 */
interface RpcResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}
function callRpc(name: "admin_set_dispatch_setting" | "admin_redispatch_order", args: Record<string, unknown>): PromiseLike<RpcResult> {
  return (createAdminClient() as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult> }).rpc(name, args);
}

/** Who may change rider matching. The RPC enforces the same tier; a "no" from it is turned into this wording. */
const SETTING_PERMISSION_MESSAGE = "Only admins can change rider matching. Ask an admin or a superadmin to do it.";

function revalidateDispatch() {
  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  revalidatePath("/admin/dispatch");
  revalidatePath("/admin/audit");
}

/**
 * Sets one rider-matching setting (distance, riders per offer, widen delay,
 * notify-store delay, location freshness). The typed value is validated here;
 * the RPC re-checks the range and writes the audit row. Applies to orders from
 * now on; offers already sent are unchanged.
 */
export async function setDispatchSettingAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdminContext();

  const parsed = setDispatchSettingSchema.safeParse({
    key: field(formData, "key"),
    input: field(formData, "value"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { error } = await callRpc("admin_set_dispatch_setting", {
    p_key: parsed.data.key,
    p_value: parsed.data.value,
    p_reason: parsed.data.reason,
    p_actor_id: session.userId,
  });
  if (error) return { error: error.code === "42501" ? SETTING_PERMISSION_MESSAGE : rpcFailureMessage(error) };

  revalidateDispatch();
  return { success: true, message: "Saved. It applies to orders from now on; offers already sent are unchanged." };
}

/** Orders being re-sent right now in this server process: a second click while the first is running is ignored. */
const inFlight = new Set<string>();

/**
 * Sends a ready order with no rider to riders again, using the current
 * settings. Moves no money. The result ("Sent to 3 riders" / "No riders in
 * range") is shown on the button that was pressed.
 */
export async function redispatchOrderAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdminContext();

  const parsed = redispatchOrderSchema.safeParse({ orderId: field(formData, "orderId") });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { orderId } = parsed.data;

  if (inFlight.has(orderId)) return { error: "This order is already being sent to riders. Give it a moment." };
  inFlight.add(orderId);
  try {
    const { data, error } = await callRpc("admin_redispatch_order", {
      p_order_id: orderId,
      p_reason: "Sent to riders again from the Waiting for a rider page",
      p_actor_id: session.userId,
    });
    if (error) return { error: rpcFailureMessage(error) };

    revalidateDispatch();
    revalidatePath(`/admin/orders/${orderId}`);
    return { success: true, message: redispatchMessage(parseRedispatchResult(data)) };
  } finally {
    inFlight.delete(orderId);
  }
}
