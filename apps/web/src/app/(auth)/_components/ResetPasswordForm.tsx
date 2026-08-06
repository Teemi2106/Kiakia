"use client";

import { updatePasswordAction, type FormState } from "@/app/actions/auth";
import { Button, Input } from "@kiakia/ui";
import { useActionState } from "react";

const initialState: FormState = {};

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePasswordAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div>
        <label htmlFor="password" className="text-sm font-medium text-ink">
          New password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className="mt-1 w-full"
        />
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" loading={pending} className="mt-1 w-full">
        Set new password
      </Button>
    </form>
  );
}
