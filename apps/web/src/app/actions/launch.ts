"use server";

import { createHmac } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { serverEnv } from "@/lib/env.server";
import { LAUNCH_CONSENT_VERSION } from "@/lib/launch/config";
import { createLaunchUnsubscribeToken, isLaunchUnsubscribeToken } from "@/lib/launch/unsubscribe-token";
import { unsubscribeFromLaunch } from "@/lib/launch/unsubscribe";
import { createAdminClient } from "@/lib/supabase/admin";

export interface LaunchSignupState {
  status?: "success" | "error";
  message?: string;
  unsubscribeUrl?: string;
  welcomeQueued?: boolean;
}

const signupSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(254, "That email address is too long."),
  consent: z.literal("yes", { errorMap: () => ({ message: "Please agree to receive the launch announcement and relevant pre-launch updates." }) }),
});

function fingerprint(value: string) {
  return createHmac("sha256", serverEnv.SUPABASE_SERVICE_ROLE_KEY).update(value, "utf8").digest("hex");
}

export async function subscribeToLaunchAction(_previous: LaunchSignupState, formData: FormData): Promise<LaunchSignupState> {
  // Honeypot submissions are never stored or exposed to the campaign list.
  if (String(formData.get("website") ?? "").trim()) {
    return { status: "error", message: "We couldn’t save your email just now. Please try again shortly." };
  }

  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    consent: formData.get("consent"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }

  const requestHeaders = await headers();
  const clientAddress =
    requestHeaders.get("cf-connecting-ip") ??
    requestHeaders.get("x-real-ip") ??
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const rateKey = fingerprint(clientAddress ? `ip:${clientAddress}` : `email:${parsed.data.email.toLowerCase()}`);
  const { token, tokenHash } = createLaunchUnsubscribeToken();
  const { data, error } = await createAdminClient().rpc("subscribe_launch_email", {
    p_email: parsed.data.email.toLowerCase(),
    p_rate_key: rateKey,
    p_consent_version: LAUNCH_CONSENT_VERSION,
    p_unsubscribe_token_hash: tokenHash,
  });

  if (error) return { status: "error", message: "We couldn’t save your email just now. Please try again shortly." };
  const outcome = Array.isArray(data) ? data[0]?.outcome : undefined;
  if (outcome === "rate_limited") {
    return { status: "error", message: "Too many attempts from this connection. Please try again in an hour." };
  }
  if (outcome !== "subscribed" && outcome !== "already_subscribed") {
    return { status: "error", message: "We couldn’t save your email just now. Please try again shortly." };
  }

  revalidatePath("/admin/launch-subscribers");
  return {
    status: "success",
    message: outcome === "subscribed"
      ? "You’re officially on the list. Your KiaKia welcome email is on its way."
      : "You’re already on the list. Your KiaKia launch update is saved.",
    welcomeQueued: outcome === "subscribed",
    unsubscribeUrl: `/launch/unsubscribe?token=${encodeURIComponent(token)}`,
  };
}

export async function unsubscribeFromLaunchAction(formData: FormData): Promise<void> {
  const token = formData.get("token");
  const validToken = isLaunchUnsubscribeToken(token) ? token : null;
  const removed = await unsubscribeFromLaunch(validToken);
  if (removed) revalidatePath("/admin/launch-subscribers");
  redirect(`/launch/unsubscribe?result=${removed ? "unsubscribed" : "invalid"}`);
}
