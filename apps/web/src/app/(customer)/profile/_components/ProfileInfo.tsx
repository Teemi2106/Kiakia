"use client";

import { Button, Input } from "@kiakia/ui";
import { Check } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const [name, setName] = useState(fullName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("You're signed out — sign in again to save changes.");
      setSaving(false);
      return;
    }
    const { error: updateError } = await supabase.from("profiles").update({ full_name: name }).eq("id", user.id);
    if (updateError) {
      setError("Couldn't save your name. Please try again.");
      setSaving(false);
      return;
    }
    setSaved(true);
    setSaving(false);
    router.refresh();
  }

  function onNameChange(value: string) {
    setName(value);
    setSaved(false);
  }

  return (
    <div className="mt-6 rounded-2xl border border-[#E5E2E1] bg-white p-6 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[#FFDCC5] font-sora text-lg font-bold text-[#934B00]">
          {name.trim().charAt(0).toUpperCase() || "?"}
        </div>
        <div>
          <p className="font-sora text-lg font-semibold text-[#1C1B1B]">{name || "Add your name"}</p>
          {memberSince && (
            <p className="font-inter text-xs text-[#5B403C]">
              Member since {new Date(memberSince).toLocaleDateString("en-NG", { month: "long", year: "numeric" })}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <div>
          <label htmlFor="fullName" className="font-inter text-xs font-semibold uppercase tracking-wide text-[#5B403C]">
            Full name
          </label>
          <Input
            id="fullName"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="mt-1.5 w-full rounded-xl border-[#E5E2E1] font-inter text-sm text-[#1C1B1B] focus:border-[#B61913]"
          />
        </div>
        <div>
          <label className="font-inter text-xs font-semibold uppercase tracking-wide text-[#5B403C]">Email</label>
          <p className="mt-1.5 rounded-xl border border-[#E5E2E1] bg-[#FCF9F8] px-3 py-2.5 font-inter text-sm text-[#5B403C]">
            {email}
          </p>
        </div>
        {phone && (
          <div>
            <label className="font-inter text-xs font-semibold uppercase tracking-wide text-[#5B403C]">Phone</label>
            <p className="mt-1.5 rounded-xl border border-[#E5E2E1] bg-[#FCF9F8] px-3 py-2.5 font-inter text-sm text-[#5B403C]">
              {phone}
            </p>
          </div>
        )}
        {error && <p className="font-inter text-xs font-medium text-[#BA1A1A]">{error}</p>}
        <Button
          onClick={() => void save()}
          loading={saving}
          className="self-start rounded-xl bg-[#B61913] px-5 font-inter text-sm font-semibold text-white hover:bg-[#9A1410]"
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
