"use client";

import { requestPasswordResetAction, type FormState } from "@/app/actions/auth";
import { Button, Input } from "@kiakia/ui";
import { ArrowRight, Mail } from "lucide-react";
import { useActionState } from "react";

const initialState: FormState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  if (state.success) {
    return (
      <p className="font-inter text-sm leading-6 text-[#5B403C]" role="status">
        {state.success}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <label htmlFor="email" className="mb-1.5 block font-inter text-sm font-semibold tracking-[0.14px] text-[#1C1B1B]">
          Email Address
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#5B403C]" />
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="hello@example.com"
            autoComplete="email"
            required
            className="h-[53px] w-full rounded-xl border-[#E5E2E1] bg-[#FCF9F8] pl-9 pr-3 font-inter text-base text-[#5B403C] placeholder:text-[rgba(91,64,60,0.5)] focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
          />
        </div>
      </div>

      <Button
        type="submit"
        loading={pending}
        className="mt-1 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#B61913] font-inter text-sm font-semibold tracking-[0.14px] text-white transition-all hover:bg-[#9e1611] active:scale-[0.98] [&_svg]:size-[13.33px]"
      >
        <span>Send reset link</span>
        <ArrowRight className="size-4 shrink-0" />
      </Button>
    </form>
  );
}
