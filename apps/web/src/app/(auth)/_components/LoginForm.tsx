"use client";

import {
  loginAction,
  verifyEmailAction,
  vendorVerifyEmailAction,
  type FormState,
} from "@/app/actions/auth";
import { Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { AuthField, AuthPasswordField } from "./AuthField";
import { AuthError, AuthSubmit } from "./AuthFeedback";
import { OAuthButtons } from "./OAuthButtons";
import { VerifyCodeForm } from "./VerifyCodeForm";
import type { OAuthIntent } from "@/app/actions/auth";

const initialState: FormState = {};

interface LoginFormProps {
  /** Defaults to the customer loginAction; pass vendorLoginAction for /vendor/login. */
  action?: typeof loginAction;
  /** Same-origin path to return to after signing in (already validated by the page). */
  next?: string | null;
  intent?: OAuthIntent;
  oauthError?: string | null;
}

export function LoginForm({ action = loginAction, next = null, intent = "customer", oauthError = null }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  if (state.verifyEmail) {
    return (
      <VerifyCodeForm
        email={state.verifyEmail}
        action={intent === "vendor" ? vendorVerifyEmailAction : verifyEmailAction}
        next={next}
        signInHref={intent === "vendor" ? "/vendor/login" : "/login"}
        initialError={state.error}
        initialNotice={state.success}
      />
    );
  }

  return (
    <div className="rounded-3xl border border-kk-line/50 bg-kk-card/80 p-6 shadow-[0_24px_60px_-40px_rgba(28,27,27,0.45)] backdrop-blur-sm sm:p-7">
      <form action={formAction} className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <AuthError message={state.error} />

        <AuthField
          name="email"
          type="email"
          label="Email address"
          icon={Mail}
          autoComplete="email"
          autoFocus
          required
        />

        <AuthPasswordField
          name="password"
          label="Password"
          icon={Lock}
          autoComplete="current-password"
          required
        />

        <div className="-mt-1 flex justify-end">
          <Link
            href="/forgot-password"
            className="font-inter text-[13px] font-semibold text-kk-cocoa/80 underline-offset-4 transition-colors hover:text-(--auth-accent-ink) hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <AuthSubmit pending={pending}>Sign in</AuthSubmit>
      </form>

      <OAuthButtons next={next} intent={intent} initialError={oauthError} />
    </div>
  );
}
