"use client";

import { Button, Card, Input } from "@kiakia/ui";
import { useState } from "react";
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
  const [name, setName] = useState(fullName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").update({ full_name: name }).eq("id", user.id);
      setSaved(true);
    }
    setSaving(false);
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
          <Input id="fullName" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full" />
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
        <Button onClick={() => void save()} loading={saving} variant="secondary" className="self-start">
          {saved ? "Saved ✓" : "Save changes"}
        </Button>
      </div>
    </Card>
  );
}
