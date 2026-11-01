"use client";

import { Button, Input } from "@kiakia/ui";
import { Check } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCustomerStore } from "@/lib/customer/CustomerStoreProvider";
import { createClient } from "@/lib/supabase/client";

export function ProfileInfo({
  fullName,
  email,
  phone,
  memberSince,
}: {
  fullName: string;
  email: string | null;
  phone: string | null | undefined;
  memberSince: string | null | undefined;
}) {
  const router = useRouter();
  const userId = useCustomerStore((s) => s.userId);
  const [name, setName] = useState(fullName);
  const [, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shows "Saved" at once and settles behind it; if the write fails the button
  // goes back and the error says so. RLS ("update own profile") is what scopes
  // the write to the caller.
  function save() {
    setSaved(true);
    setError(null);
    startTransition(async () => {
      const { error: updateError } = await createClient().from("profiles").update({ full_name: name }).eq("id", userId);
      if (updateError) {
        setSaved(false);
        setError("Couldn't save your name. Please try again.");
        return;
      }
      router.refresh();
    });
  }

  function onNameChange(value: string) {
    setName(value);
    setSaved(false);
  }

  return (
    <div className="mt-6 rounded-2xl border border-kk-hair bg-kk-card p-6 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-notice-surface font-sora text-lg font-bold text-kk-orange-ink">
          {name.trim().charAt(0).toUpperCase() || "?"}
        </div>
        <div>
          <p className="font-sora text-lg font-semibold text-kk-ink">{name || "Add your name"}</p>
          {memberSince && (
            <p className="font-inter text-xs text-kk-cocoa">
              Member since {new Date(memberSince).toLocaleDateString("en-NG", { month: "long", year: "numeric" })}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <div>
          <label htmlFor="fullName" className="font-inter text-xs font-semibold uppercase tracking-wide text-kk-cocoa">
            Full name
          </label>
          <Input
            id="fullName"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="mt-1.5 w-full rounded-xl border-kk-hair font-inter text-sm text-kk-ink focus:border-kk-red"
          />
        </div>
        <div>
          <label className="font-inter text-xs font-semibold uppercase tracking-wide text-kk-cocoa">Email</label>
          <p className="mt-1.5 rounded-xl border border-kk-hair bg-kk-cream px-3 py-2.5 font-inter text-sm text-kk-cocoa">
            {email}
          </p>
        </div>
        {phone && (
          <div>
            <label className="font-inter text-xs font-semibold uppercase tracking-wide text-kk-cocoa">Phone</label>
            <p className="mt-1.5 rounded-xl border border-kk-hair bg-kk-cream px-3 py-2.5 font-inter text-sm text-kk-cocoa">
              {phone}
            </p>
          </div>
        )}
        {error && <p className="font-inter text-xs font-medium text-kk-danger-ink">{error}</p>}
        <Button
          onClick={save}
          className="self-start rounded-xl bg-kk-red px-5 font-inter text-sm font-semibold text-white hover:bg-[#9A1410]"
        >
          {saved ? (
            <>
              <Check className="size-4" />
              Saved
            </>
          ) : (
            "Save changes"
          )}
        </Button>
      </div>
    </div>
  );
}
