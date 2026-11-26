"use server";

import { revalidatePath } from "next/cache";
import { requireFinanceContext } from "@/lib/auth/dal";
import { field, rpcFailureMessage, type FormState } from "@/lib/admin/action-helpers";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function reviewCustomerWalletWithdrawalAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireFinanceContext();
  const requestId = field(formData, "requestId") ?? "";
  const decision = field(formData, "decision") ?? "";
  if (!UUID_PATTERN.test(requestId)) return { error: "Refresh the page and select the request again." };
  if (!(["approve", "reject", "mark_paid"] as const).includes(decision as "approve" | "reject" | "mark_paid")) {
    return { error: "Choose a valid review action." };
  }

  const { error } = await createAdminClient().rpc("admin_review_customer_wallet_withdrawal", {
    p_request_id: requestId,
    p_decision: decision,
    p_external_reference: field(formData, "externalReference") ?? "",
    p_reason: field(formData, "reason") ?? "",
    p_actor_id: session.userId,
  });

  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath("/admin/payouts");
  revalidatePath("/profile/wallet");
  const message = decision === "approve"
    ? "Request approved. Funds remain reserved until transfer or rejection."
    : decision === "reject"
      ? "Request rejected and its reserved amount released."
      : "Withdrawal marked as paid and recorded in the wallet ledger.";
  return { success: true, message };
}
