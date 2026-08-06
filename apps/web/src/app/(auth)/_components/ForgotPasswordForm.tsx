"use client";

import { requestPasswordResetAction, type FormState } from "@/app/actions/auth";
import { Button, Input } from "@kiakia/ui";
import { useActionState } from "react";

const initialState: FormState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  if (state.success) {
    return <p className="text-sm text-ink">{state.success}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div>
        <label htmlFor="email" className="text-sm font-medium text-ink">
          Email Address
        </label>
        <Input id="email" name="email" type="email" autoComplete="email" required className="mt-1 w-full" />
      </div>
      <Button type="submit" loading={pending} className="mt-1 w-full">
        Send reset link
      </Button>
    </form>
  );
}
