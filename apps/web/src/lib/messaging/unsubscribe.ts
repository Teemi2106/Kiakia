import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env.server";
import { verifyUnsubscribeToken, type UnsubscribeClaim } from "./unsubscribe-token";

/** The claim in a genuine token, or null. Also null when no secret is configured: nothing can be verified, so nothing is accepted. */
export function readUnsubscribeToken(token: string | null | undefined): UnsubscribeClaim | null {
  const secret = serverEnv.MESSAGE_UNSUBSCRIBE_SECRET;
  return secret ? verifyUnsubscribeToken(secret, token) : null;
}

export type UnsubscribeOutcome = "done" | "invalid" | "failed";

/**
 * Turns off promotions on one channel for the person in the token. Service
 * role on purpose: the person is not signed in. Idempotent (message_opt_out only ever
 * switches a flag off, and records the withdrawal), so a link scanner, a retry or a second click is harmless.
 * Service messages (order updates and the like) are not affected.
 */
export async function applyUnsubscribe(token: string | null | undefined): Promise<UnsubscribeOutcome> {
  const claim = readUnsubscribeToken(token);
  if (!claim) return "invalid";

  const admin = createAdminClient();
  const { error } = await admin.rpc("message_opt_out", { p_user_id: claim.userId, p_channel: claim.channel, p_source: "unsubscribe_link" });
  if (error) {
    console.error("unsubscribe failed", error.message);
    return "failed";
  }
  return "done";
}
