"use client";

import { updatePasswordAction, type FormState } from "@/app/actions/auth";
import { Button, Input } from "@kiakia/ui";
import { ArrowRight, Eye, EyeOff, Lock } from "lucide-react";
import { useActionState, useState } from "react";

const initialState: FormState = {};

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePasswordAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <label htmlFor="password" className="mb-1.5 block font-inter text-sm font-semibold tracking-[0.14px] text-[#1C1B1B]">
          New Password
        </label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#5B403C]" />
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            className="h-[53px] w-full rounded-xl border-[#E5E2E1] bg-[#FCF9F8] pl-9 pr-9 font-inter text-base text-[#5B403C] placeholder:text-[rgba(91,64,60,0.5)] focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5B403C] hover:text-[#1C1B1B]"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <p className="mt-1.5 font-inter text-xs text-[rgba(91,64,60,0.7)]">
          At least 8 characters, with one letter and one number.
        </p>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button
        type="submit"
        loading={pending}
        className="mt-1 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#B61913] font-inter text-sm font-semibold tracking-[0.14px] text-white transition-all hover:bg-[#9e1611] active:scale-[0.98] [&_svg]:size-[13.33px]"
      >
        <span>Set new password</span>
        <ArrowRight className="size-4 shrink-0" />
      </Button>
    </form>
  );
}
