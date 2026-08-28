"use client";

import { loginAction, type FormState } from "@/app/actions/auth";
import { Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { AuthField, AuthPasswordField } from "./AuthField";
import { AuthError, AuthSubmit } from "./AuthFeedback";
import { OAuthButtons } from "./OAuthButtons";

const initialState: FormState = {};

interface LoginFormProps {
  /** Defaults to the customer loginAction; pass vendorLoginAction for /vendor/login. */
  action?: typeof loginAction;
}

export function LoginForm({ action = loginAction }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div className="rounded-3xl border border-kk-line/50 bg-white/80 p-6 shadow-[0_24px_60px_-40px_rgba(28,27,27,0.45)] backdrop-blur-sm sm:p-7">
      <form action={formAction} className="flex flex-col gap-4">
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
            className="font-inter text-[13px] font-semibold text-kk-cocoa/80 underline-offset-4 transition-colors hover:text-(--auth-accent) hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <AuthSubmit pending={pending}>Sign in</AuthSubmit>
      </form>

      <OAuthButtons />
    </div>
  );
}
