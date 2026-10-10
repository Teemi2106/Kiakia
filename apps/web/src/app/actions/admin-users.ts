"use server";

import { revalidatePath } from "next/cache";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { field, rpcFailureMessage, type FormState } from "@/lib/admin/action-helpers";
import { firstIssue, setPlatformRoleSchema, setUserStatusSchema } from "@/lib/validation/admin";

/**
 * Ban applied alongside a DB suspension. Supabase Auth takes a Go-style
 * duration; 100 years is "until reinstated". The ban, not profiles.status,
 * is what actually blocks sign-in and token refresh on the web and rider apps.
 */
const SUSPENSION_BAN_DURATION = "876000h";

const BAN_DEFERRED_MESSAGE =
  "Suspended. This rider is finishing a delivery, so their sessions will be revoked when it completes. Submit the suspension again afterwards to block sign-in.";

/**
 * Suspends or reinstates a user: admin_set_user_status() records the state
 * and the audit row first (and, for a suspension, revokes the user's auth
 * sessions), then the Auth ban is applied or lifted.
 *
 * A rider on a delivery in progress is the exception: the RPC keeps their
 * sessions so they can finish it and reports "sign_in_ban_deferred", and no
 * ban is applied yet - the sessions are revoked when the delivery ends and the
 * suspension is submitted again to apply the ban.
 *
 * A suspension is safely re-runnable: the RPC is idempotent (no second audit
 * row) and the ban is applied unconditionally afterwards, so if it failed the
 * first time, submitting the same form again finishes the job.
 *
 * The ban is lifted only when the RPC reports a real suspended -> active
 * transition, so reinstating an account that was never suspended cannot clear
 * a ban put there for another reason. The flip side: if lifting the ban fails,
 * the account is already active and a resubmit changes nothing, so the admin
 * has to suspend and reinstate it again.
 */
export async function setUserStatusAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdminContext();

  const parsed = setUserStatusSchema.safeParse({
    userId: field(formData, "userId"),
    status: field(formData, "status"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const admin = createAdminClient();

  const { data: change, error } = await admin.rpc("admin_set_user_status", {
    p_user_id: parsed.data.userId,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason ?? null,
    p_actor_id: session.userId,
  });
  if (error) return { error: rpcFailureMessage(error) };

  const suspending = parsed.data.status === "suspended";
  const banDeferred = suspending && change?.sign_in_ban_deferred === true;
  const liftingBan = !suspending && change?.changed === true && change.previous_status === "suspended";

  if ((suspending && !banDeferred) || liftingBan) {
    const { error: banError } = await admin.auth.admin.updateUserById(parsed.data.userId, {
      ban_duration: suspending ? SUSPENSION_BAN_DURATION : "none",
    });
    if (banError) {
      console.error("setUserStatusAction: auth ban update failed", banError);
      return {
        error: suspending
          ? "The account status was saved, but sign-in access could not be updated. Submit again to retry."
          : "The account was reinstated, but its sign-in ban could not be lifted. Suspend and reinstate it again to retry.",
      };
    }
  }

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return banDeferred ? { success: true, message: BAN_DEFERRED_MESSAGE } : { success: true };
}

/**
 * Grants or revokes a platform role. 'rider' needs an admin; 'admin' and
 * 'superadmin' need a superadmin — enforced inside the RPC, which also refuses
 * self-changes and removing the last active superadmin.
 */
export async function setPlatformRoleAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdminContext();

  const parsed = setPlatformRoleSchema.safeParse({
    userId: field(formData, "userId"),
    role: field(formData, "role"),
    action: field(formData, "action"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { error } = await createAdminClient().rpc("admin_set_platform_role", {
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role,
    p_grant: parsed.data.action === "grant",
    p_reason: parsed.data.reason,
    p_actor_id: session.userId,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { success: true };
}
