import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashLaunchUnsubscribeToken, isLaunchUnsubscribeToken } from "./unsubscribe-token";

export async function canUnsubscribeFromLaunch(token: unknown) {
  if (!isLaunchUnsubscribeToken(token)) return false;
  const { data, error } = await createAdminClient().rpc("validate_launch_unsubscribe_token", {
    p_token_hash: hashLaunchUnsubscribeToken(token),
  });
  if (error) return false;
  return data === true;
}

export async function unsubscribeFromLaunch(token: unknown) {
  if (!isLaunchUnsubscribeToken(token)) return false;
  const { data, error } = await createAdminClient().rpc("unsubscribe_launch_email", {
    p_token_hash: hashLaunchUnsubscribeToken(token),
  });
  if (error) return false;
  return data === true;
}
