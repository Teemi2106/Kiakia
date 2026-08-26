"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, loginSchema, passwordSchema, registerSchema } from "@/lib/validation/auth";
import { serverEnv } from "@/lib/env.server";
import { getRoles, hasRole, VENDOR_ROLES } from "@/lib/auth/dal";
import { clearActiveRole, setActiveRole } from "@/lib/auth/active-role";

/**
 * Email + password, per the Figma registration/login screens (switched
 * from Phase 0's phone-OTP flow — phone is still collected, as a profile
 * field, not the auth mechanism). Every Server Function here is a public
 * POST endpoint (Next.js's own auth guide, verbatim) — Supabase Auth is
 * the actual authority on whether credentials are valid, this code only
 * shapes the request/response around it.
 */

export interface FormState {
  readonly error?: string;
  readonly success?: string;
}

export async function registerAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName, phone: parsed.data.phone },
      emailRedirectTo: `${serverEnv.NEXT_PUBLIC_SITE_URL}/login`,
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      return { error: "An account with that email already exists." };
    }
    return { error: "We couldn't create your account. Please try again." };
  }

  // Supabase returns a session immediately only when email confirmation is
  // disabled on the project; otherwise there's no session until the user
  // clicks the confirmation link, and redirecting to /home would just
  // bounce off proxy.ts. Handle both without assuming the project's config.
  if (data.session) {
    await setActiveRole("customer");
    redirect("/home");
  }

  return { success: "Check your email to confirm your account, then sign in." };
}

/**
 * Same signUp() call as registerAction, kept as a separate action (rather
 * than a `role` parameter on registerAction) so the /vendor/register form
 * posts to a distinct, statically-analyzable endpoint — and so the
 * post-signup redirect can go straight to the vendor application instead of
 * /home. The account itself is identical; a customer and a would-be vendor
 * both just get a Supabase auth user until /onboarding grants a vendor role.
 */
export async function vendorRegisterAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName, phone: parsed.data.phone },
      emailRedirectTo: `${serverEnv.NEXT_PUBLIC_SITE_URL}/vendor/login`,
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      return { error: "An account with that email already exists." };
    }
    return { error: "We couldn't create your account. Please try again." };
  }

  if (data.session) {
    redirect("/onboarding");
  }

  return { success: "Check your email to confirm your account, then sign in to apply as a vendor." };
}

export async function loginAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "Incorrect email or password." };
  }

  // Logging in through the customer form is an explicit "I want customer
  // mode" signal — resets any lingering vendor mode from a previous session
  // in this browser (e.g. a shared device, or switching accounts).
  await setActiveRole("customer");
  redirect("/home");
}

/**
 * Same credential check as loginAction, but for the /vendor/login form:
 * routes an existing vendor straight to /dashboard, and anyone without a
 * vendor role yet to /onboarding to apply — never to the customer /home.
 */
export async function vendorLoginAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "Incorrect email or password." };
  }

  const roles = await getRoles();
  if (!hasRole(roles, ...VENDOR_ROLES)) {
    // S3 (independent security review): without this, a non-vendor account
    // signing in through /vendor/login left behind whatever kk_active_role
    // cookie a previous session in this browser had set — including
    // "vendor" from an earlier vendor session on a shared device. Combined
    // with the (customer) layout's vendor-mode bounce, that stale cookie
    // could loop this account between /home (bounced to /dashboard because
    // the cookie says "vendor") and /dashboard (bounced to /home by
    // requireVendorContext() because this account doesn't actually hold a
    // vendor role). Reset to "customer" before sending it to /onboarding,
    // the same explicit signal loginAction already gives every customer
    // sign-in.
    await setActiveRole("customer");
    redirect("/onboarding");
  }

  await setActiveRole("vendor");
  redirect("/dashboard");
}

export async function requestPasswordResetAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));

  // Always return the same message whether or not the email exists —
  // confirming/denying account existence here is a user-enumeration leak.
  const genericSuccess: FormState = {
    success: "If an account exists for that email, a reset link is on its way.",
  };

  if (!parsed.success) {
    return genericSuccess;
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${serverEnv.NEXT_PUBLIC_SITE_URL}/reset-password`,
  });

  return genericSuccess;
}

export async function updatePasswordAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const parsed = passwordSchema.safeParse(formData.get("password"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Choose a stronger password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });

  if (error) {
    return { error: "That reset link has expired. Request a new one." };
  }

  redirect("/home");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Clear the active-role cookie too — otherwise a shared device retains
  // vendor mode across different accounts signing in afterwards via a
  // route that doesn't itself reset it (e.g. deep-linking straight to
  // /login instead of /vendor/login).
  await clearActiveRole();
  redirect("/login");
}
