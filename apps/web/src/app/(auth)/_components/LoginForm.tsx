"use client";

import { loginAction, type FormState } from "@/app/actions/auth";
import { Button, Input } from "@kiakia/ui";
import Link from "next/link";
import { useActionState } from "react";
import { OAuthButtons } from "./OAuthButtons";

const initialState: FormState = {};

interface LoginFormProps {
  /** Defaults to the customer loginAction; pass vendorLoginAction for /vendor/login. */
  action?: typeof loginAction;
}

export function LoginForm({ action = loginAction }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <>
      <form action={formAction} className="flex flex-col gap-3">
        <div>
          <label htmlFor="email" className="text-sm font-medium text-ink">
            Email Address
          </label>
          <Input id="email" name="email" type="email" autoComplete="email" required className="mt-1 w-full" />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium text-ink">
              Password
            </label>
            <Link href="/forgot-password" className="text-xs font-medium text-brand-600 hover:underline">
              Forgot Password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full"
          />
        </div>
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        <Button type="submit" loading={pending} className="mt-1 w-full">
          Sign In
        </Button>
      </form>
      <OAuthButtons />
    </>
  );
}
