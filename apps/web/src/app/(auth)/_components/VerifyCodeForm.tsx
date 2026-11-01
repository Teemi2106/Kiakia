"use client";

import { resendSignupCodeAction, type FormState } from "@/app/actions/auth";
import { KeyRound, MailCheck } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { AuthField } from "./AuthField";
import { AuthError, AuthSubmit } from "./AuthFeedback";

const initialState: FormState = {};
const RESEND_COOLDOWN_SECONDS = 60;

interface VerifyCodeFormProps {
  email: string;
  /** The register form's own verify action (customer vs vendor destination). */
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  /** Same-origin path to return to once verified (already validated by the page). */
  next?: string | null;
  signInHref?: string;
}

/**
 * Code-entry step shown in place of the register form once signUp() has sent
 * the confirmation email. The code itself is Supabase's — see
 * verifySignupCode() in actions/auth.ts.
 */
export function VerifyCodeForm({ email, action, next = null, signInHref = "/login" }: VerifyCodeFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [resendState, resendAction, resending] = useActionState(resendSignupCodeAction, initialState);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  // A fresh code was just sent (by signUp, or by the last resend) — restart
  // the cooldown so the button can't be hammered against Supabase's rate limit.
  useEffect(() => {
    if (resendState.success) setCooldown(RESEND_COOLDOWN_SECONDS);
  }, [resendState]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  return (
    <div className="rounded-3xl border border-kk-line/60 bg-kk-card p-7 shadow-[0_20px_50px_-30px_rgba(28,27,27,0.4)]">
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-positive-surface">
          <MailCheck className="size-6 text-kk-green-ink" />
        </span>
        <h2 className="mt-5 font-sora text-xl font-bold tracking-[-0.02em] text-kk-ink">Enter your code</h2>
        <p className="mt-2 font-inter text-[14px] leading-6 text-kk-cocoa">
          We sent a verification code to <span className="font-semibold text-kk-ink">{email}</span>.
        </p>
      </div>

      <form action={formAction} className="mt-6 flex flex-col gap-4">
        <input type="hidden" name="email" value={email} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <AuthError message={state.error} />

        <AuthField
          name="code"
          type="text"
          label="Verification code"
          icon={KeyRound}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6,10}"
          maxLength={10}
          autoFocus
          required
        />

        <AuthSubmit pending={pending}>Verify and continue</AuthSubmit>
      </form>

      <form action={resendAction} className="mt-4 text-center font-inter text-sm text-kk-cocoa">
        <input type="hidden" name="email" value={email} />
        <AuthError message={resendState.error} />
        {resendState.success ? (
          <p role="status" className="mb-2 text-kk-green-ink">
            {resendState.success}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={cooldown > 0 || resending}
          className="font-semibold text-kk-ink underline underline-offset-2 disabled:pointer-events-none disabled:no-underline disabled:opacity-60"
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
      </form>

      <p className="mt-4 text-center font-inter text-xs text-kk-cocoa/70">
        Already verified?{" "}
        <Link href={signInHref} className="underline underline-offset-2 hover:text-kk-ink">
          Sign in
        </Link>
      </p>
    </div>
  );
}
