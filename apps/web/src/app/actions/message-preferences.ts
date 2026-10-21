"use server";

import { requireActiveAccount, verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export interface PreferencesResult {
  readonly error?: string;
}

/**
 * Saves the signed-in person's promotion choices (email, text). Runs as the
 * person (RLS client, not service role): set_message_preferences() acts on
 * auth.uid() and refuses anyone else's row. Service messages are not part of
 * this and cannot be turned off.
 */
export async function setMessagePreferencesAction(marketingEmail: boolean, marketingSms: boolean): Promise<PreferencesResult> {
  await verifySession();
  await requireActiveAccount();
  if (typeof marketingEmail !== "boolean" || typeof marketingSms !== "boolean") {
    return { error: "We could not save that. Please try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_message_preferences", {
    p_marketing_email: marketingEmail,
    p_marketing_sms: marketingSms,
  });
  if (error) {
    console.error("set_message_preferences failed", error.message);
    return { error: "We could not save that. Please try again." };
  }
  return {};
}
