"use client";

import { registerAction, type FormState } from "@/app/actions/auth";
import { Lock, Mail, Phone, User } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { AuthField, AuthPasswordField } from "./AuthField";
import { AuthError, AuthSubmit, AuthSuccess } from "./AuthFeedback";
import { OAuthButtons } from "./OAuthButtons";

const initialState: FormState = {};

interface RegisterFormProps {
  /** Defaults to the customer registerAction; pass vendorRegisterAction for /vendor/register. */
  action?: typeof registerAction;
  /** Where the post-signup "sign in" button points. */
  signInHref?: string;
}

export function RegisterForm({ action = registerAction, signInHref = "/login" }: RegisterFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  // "Check your email to confirm" — the account exists, so the form has
  // nothing left to collect. Replace it rather than leaving five filled
  // fields sitting under a success message.
  if (state.success) {
    return (
      <AuthSuccess
        message={state.success}
        action={
          <Link
            href={signInHref}
            className="inline-flex h-12 items-center justify-center rounded-2xl border border-kk-line px-6 font-inter text-sm font-semibold text-kk-ink transition-colors hover:bg-kk-sand"
          >
            Go to sign in
          </Link>
        }
      />
    );
  }

  return (
    <div className="rounded-3xl border border-kk-line/50 bg-white/80 p-6 shadow-[0_24px_60px_-40px_rgba(28,27,27,0.45)] backdrop-blur-sm sm:p-7">
      <form action={formAction} className="flex flex-col gap-4">
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
          label="Phone number"
          icon={Phone}
          autoComplete="tel"
          hint="We only use this to reach you about a delivery."
          required
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

      <OAuthButtons />
    </div>
  );
}
