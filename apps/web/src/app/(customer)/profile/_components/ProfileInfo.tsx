"use client";

import { Button, Card, Input } from "@kiakia/ui";
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
    <Card className="mt-4">
      <div className="flex items-center gap-3">
        <div className="flex size-14 items-center justify-center rounded-full bg-brand-100 text-lg font-semibold text-brand-700">
          {name.trim().charAt(0).toUpperCase() || "?"}
        </div>
        <div>
          <p className="font-medium text-ink">{name || "Add your name"}</p>
          {memberSince && (
            <p className="text-xs text-ink-muted">
              Member since {new Date(memberSince).toLocaleDateString("en-NG", { month: "long", year: "numeric" })}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <div>
          <label htmlFor="fullName" className="text-xs font-medium text-ink-muted">
            Full name
          </label>
          <Input id="fullName" value={name} onChange={(e) => onNameChange(e.target.value)} className="mt-1 w-full" />
        </div>
        <div>
          <label className="text-xs font-medium text-ink-muted">Email</label>
          <p className="mt-1 text-sm text-ink">{email}</p>
        </div>
        {phone && (
          <div>
            <label className="text-xs font-medium text-ink-muted">Phone</label>
            <p className="mt-1 text-sm text-ink">{phone}</p>
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button onClick={() => void save()} loading={saving} variant="secondary" className="self-start">
          {saved ? "Saved ✓" : "Save changes"}
        </Button>
      </div>
    </Card>
  );
}
