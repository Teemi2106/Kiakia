"use server";

import { redirect } from "next/navigation";
import { applyUnsubscribe } from "@/lib/messaging/unsubscribe";

/**
 * The confirm button on /unsubscribe. Not signed-in territory: the signed token
 * in the form is the only credential, and it is verified inside applyUnsubscribe().
 * Redirects back to the page, which then shows the outcome.
 */
export async function unsubscribeAction(formData: FormData): Promise<void> {
  const token = formData.get("token");
  const outcome = await applyUnsubscribe(typeof token === "string" ? token : null);
  const query = new URLSearchParams({ token: typeof token === "string" ? token : "", result: outcome });
  redirect(`/unsubscribe?${query.toString()}`);
}
