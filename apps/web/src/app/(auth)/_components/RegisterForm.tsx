"use client";

import { registerAction, verifyEmailAction, type FormState } from "@/app/actions/auth";
import type { OAuthIntent } from "@/app/actions/auth";
import { Lock, Mail, Phone, User } from "lucide-react";
import { useActionState } from "react";
import { AuthField, AuthPasswordField } from "./AuthField";
import { AuthError, AuthSubmit } from "./AuthFeedback";
import { OAuthButtons } from "./OAuthButtons";
import { VerifyCodeForm } from "./VerifyCodeForm";

const initialState: FormState = {};

interface RegisterFormProps {
  /** Defaults to the customer registerAction; pass vendorRegisterAction for /vendor/register. */
  action?: typeof registerAction;
  /** Defaults to verifyEmailAction; pass vendorVerifyEmailAction for /vendor/register. */
  verifyAction?: typeof verifyEmailAction;
  /** Where the post-signup "sign in" button points. */
  signInHref?: string;
  /** Customers add a phone at checkout, so signup can skip it; vendors still need it up front. */
  phoneOptional?: boolean;
  /** Same-origin path to return to once signed in (already validated by the page). */
  next?: string | null;
  intent?: OAuthIntent;
  oauthError?: string | null;
}

export function RegisterForm({
  action = registerAction,
  verifyAction = verifyEmailAction,
  signInHref = "/login", phoneOptional = false,
  next = null,
  intent = "customer",
  oauthError = null,
}: RegisterFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  // The account exists and a code is in the user's inbox, so the form has
  // nothing left to collect. Replace it with the code-entry step rather than
  // leaving five filled fields on screen.
  if (state.verifyEmail) {
    return <VerifyCodeForm email={state.verifyEmail} action={verifyAction} next={next} signInHref={signInHref} />;
  }

  return (
    <div className="rounded-3xl border border-kk-line/50 bg-kk-card/80 p-6 shadow-[0_24px_60px_-40px_rgba(28,27,27,0.45)] backdrop-blur-sm sm:p-7">
      <form action={formAction} className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <AuthError message={state.error} />

        <AuthField
          name="fullName"
          type="text"
          label="Full name"
          icon={User}
          autoComplete="name"
          autoFocus
          required
        />

        <AuthField
          name="email"
          type="email"
          label="Email address"
          icon={Mail}
          autoComplete="email"
          required
        />

        <AuthField
          name="phone"
          type="tel"
          label={phoneOptional ? "Phone number (optional)" : "Phone number"}
          icon={Phone}
          autoComplete="tel"
          hint="0801 234 5678 or +234 801 234 5678. We only use this to reach you about a delivery."
          required={!phoneOptional}
        />

        <AuthPasswordField
          name="password"
          label="Password"
          icon={Lock}
          autoComplete="new-password"
          hint="At least 8 characters, with one letter and one number."
          strength
          required
        />

        <AuthPasswordField
          name="confirmPassword"
          label="Confirm password"
          icon={Lock}
          autoComplete="new-password"
          required
        />

        <AuthSubmit pending={pending}>Create account</AuthSubmit>
      </form>

      <OAuthButtons next={next} intent={intent} initialError={oauthError} />
    </div>
  );
}
