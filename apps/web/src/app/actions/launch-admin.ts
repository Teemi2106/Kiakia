"use server";

import { revalidatePath } from "next/cache";
import { requireAdminContext, isSuperadmin } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";

export interface LaunchAnnouncementActionState {
  status?: "success" | "existing" | "error";
  message?: string;
  recipientCount?: number;
}

export async function startLaunchAnnouncementAction(
  _previous: LaunchAnnouncementActionState,
  formData: FormData,
): Promise<LaunchAnnouncementActionState> {
  const session = await requireAdminContext();
  if (!(await isSuperadmin())) {
    return { status: "error", message: "Only a superadmin can approve the launch announcement." };
  }
  if (formData.get("confirm") !== "yes" || String(formData.get("phrase") ?? "").trim() !== "ANNOUNCE KIAKIA") {
    return { status: "error", message: "Confirm the approval checkbox and type ANNOUNCE KIAKIA exactly." };
  }
  const expectedRecipientCount = Number(formData.get("expectedRecipientCount"));
  if (!Number.isInteger(expectedRecipientCount) || expectedRecipientCount < 1) {
    return { status: "error", message: "Refresh the page and review the eligible subscriber count before approving." };
  }

  const { data, error } = await createAdminClient().rpc("admin_start_launch_announcement", {
    p_actor_id: session.userId,
    p_confirmation_phrase: "ANNOUNCE KIAKIA",
    p_expected_recipient_count: expectedRecipientCount,
  });
  if (error) {
    console.error("Could not queue the launch announcement", error.code);
    return { status: "error", message: "The launch announcement was not queued. Please refresh and try again." };
  }

  const result = data as { outcome?: string; recipient_count?: number; eligible_count?: number } | null;
  if (result?.outcome === "no_recipients") {
    return { status: "error", message: "There are no active, consented launch subscribers to email." };
  }
  if (result?.outcome === "count_changed") {
    return {
      status: "error",
      message: `The eligible count changed to ${result.eligible_count ?? "a new total"}. Refresh and review the count before approving.`,
    };
  }
  if (result?.outcome === "already_started") {
    revalidatePath("/admin/launch-subscribers");
    return {
      status: "existing",
      message: "This launch announcement was already approved. No second campaign was created.",
      recipientCount: result.recipient_count,
    };
  }
  if (result?.outcome !== "started" || !Number.isInteger(result.recipient_count)) {
    return { status: "error", message: "The launch announcement was not queued. Please refresh and try again." };
  }

  revalidatePath("/admin/launch-subscribers");
  return {
    status: "success",
    message: "The launch announcement was approved and added to the email queue.",
    recipientCount: result.recipient_count,
  };
}
