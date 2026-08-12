// app/(customer)/profile/_components/SignOutButton.tsx
"use client";

import { signOutAction } from "@/app/actions/auth";
import { Button } from "@kiakia/ui";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button
        type="submit"
        variant="secondary"
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#E4BEB8] bg-white py-4 font-inter text-sm font-semibold text-[#BA1A1A] hover:bg-[#FCF9F8]"
      >
        <LogOut className="size-4" />
        Log Out
      </Button>
    </form>
  );
}
