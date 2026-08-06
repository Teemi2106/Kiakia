// components/LoginForm.tsx
"use client";

import { loginAction, type FormState } from "@/app/actions/auth";
import { Button, Input } from "@kiakia/ui";
import Link from "next/link";
import { useActionState, useState } from "react";
import { OAuthButtons } from "./OAuthButtons";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";

const initialState: FormState = {};

interface LoginFormProps {
  /** Defaults to the customer loginAction; pass vendorLoginAction for /vendor/login. */
  action?: typeof loginAction;
}

export function LoginForm({ action = loginAction }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <>
      <form action={formAction} className="flex flex-col gap-3">
        <div>
          <label htmlFor="email" className="text-sm font-medium text-ink">
            Email Address
          </label>
          <div className="relative mt-1">
            <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="hello@example.com"
              autoComplete="email"
              required
              className="w-full pl-9"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium text-ink">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-[#B61913] hover:underline"
            >
              Forgot Password?
            </Link>
          </div>
          <div className="relative mt-1">
            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              className="w-full pl-9 pr-9"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
        </div>

        {state.error && <p className="text-sm text-danger">{state.error}</p>}

        <Button
          type="submit"
          loading={pending}
          className="mt-1 w-full gap-2 flex items-center justify-center"
        >
          <span>Sign In</span>
          <ArrowRight className="size-4 shrink-0" />
        </Button>
      </form>
      <OAuthButtons />
    </>
  );
}
