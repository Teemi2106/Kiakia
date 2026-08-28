"use client";

import { requestPasswordResetAction, type FormState } from "@/app/actions/auth";
import { Mail } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { AuthField } from "./AuthField";
import { AuthError, AuthSubmit, AuthSuccess } from "./AuthFeedback";

const initialState: FormState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  if (state.success) {
    return (
      <AuthSuccess
        message={state.success}
        action={
          <Link
            href="/login"
            className="inline-flex h-12 items-center justify-center rounded-2xl border border-kk-line px-6 font-inter text-sm font-semibold text-kk-ink transition-colors hover:bg-kk-sand"
          >
            Back to sign in
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
          name="email"
          type="email"
          label="Email address"
          icon={Mail}
          autoComplete="email"
          autoFocus
          required
        />

        <AuthSubmit pending={pending}>Send reset link</AuthSubmit>
      </form>
    </div>
  );
}
