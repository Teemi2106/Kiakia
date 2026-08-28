"use client";

import { updatePasswordAction, type FormState } from "@/app/actions/auth";
import { Lock } from "lucide-react";
import { useActionState } from "react";
import { AuthPasswordField } from "./AuthField";
import { AuthError, AuthSubmit } from "./AuthFeedback";

const initialState: FormState = {};

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePasswordAction, initialState);

  return (
    <div className="rounded-3xl border border-kk-line/50 bg-white/80 p-6 shadow-[0_24px_60px_-40px_rgba(28,27,27,0.45)] backdrop-blur-sm sm:p-7">
      <form action={formAction} className="flex flex-col gap-4">
        <AuthError message={state.error} />

        <AuthPasswordField
          name="password"
          label="New password"
          icon={Lock}
          autoComplete="new-password"
          hint="At least 8 characters, with one letter and one number."
          strength
          autoFocus
          required
        />

        <AuthSubmit pending={pending}>Set new password</AuthSubmit>
      </form>
    </div>
  );
}
