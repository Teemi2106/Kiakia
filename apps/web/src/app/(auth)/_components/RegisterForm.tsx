"use client";

import { registerAction, type FormState } from "@/app/actions/auth";
import { Button, Input } from "@kiakia/ui";
import { ArrowRight, Eye, EyeOff, Lock, Mail, Phone, User } from "lucide-react";
import { useActionState, useState } from "react";
import { OAuthButtons } from "./OAuthButtons";

const initialState: FormState = {};

interface RegisterFormProps {
  /** Defaults to the customer registerAction; pass vendorRegisterAction for /vendor/register. */
  action?: typeof registerAction;
}

export function RegisterForm({ action = registerAction }: RegisterFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  if (state.success) {
    return (
      <div className="text-center">
        <p className="text-sm text-ink">{state.success}</p>
      </div>
    );
  }

  return (
    <>
      <form action={formAction} className="flex flex-col gap-3">
        <div>
          <label htmlFor="fullName" className="text-sm font-medium text-ink">
            Full Name
          </label>
          <div className="relative mt-1">
            <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              id="fullName"
              name="fullName"
              type="text"
              placeholder="Jane Doe"
              autoComplete="name"
              required
              className="w-full !pl-12"
            />
          </div>
        </div>

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
              placeholder="jane@example.com"
              autoComplete="email"
              required
              className="w-full !pl-12"
            />
          </div>
        </div>

        <div>
          <label htmlFor="phone" className="text-sm font-medium text-ink">
            Phone Number
          </label>
          <div className="relative mt-1">
            <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              id="phone"
              name="phone"
              type="tel"
              placeholder="+2348012345678"
              autoComplete="tel"
              required
              className="w-full !pl-12"
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="text-sm font-medium text-ink">
            Password
          </label>
          <div className="relative mt-1">
            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              className="w-full !pl-12 !pr-9"
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
          <p className="mt-1.5 text-xs text-ink-muted">
            At least 8 characters, with one letter and one number.
          </p>
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="text-sm font-medium text-ink"
          >
            Confirm Password
          </label>
          <div className="relative mt-1">
            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              className="w-full !pl-12 !pr-9"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
              aria-label={
                showConfirmPassword ? "Hide password" : "Show password"
              }
            >
              {showConfirmPassword ? (
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
          <span>Create Account</span>
          <ArrowRight className="size-4 shrink-0" />
        </Button>
      </form>
      <OAuthButtons />
    </>
  );
}
