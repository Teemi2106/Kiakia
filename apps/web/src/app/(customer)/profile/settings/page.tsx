// app/(customer)/profile/settings/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { ProfileInfo } from "../_components/ProfileInfo";

export const metadata: Metadata = { title: "Account Settings" };

export default async function ProfileSettingsPage() {
  const session = await verifySession();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone, created_at")
    .eq("id", session.userId)
    .single();

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <Link
        href="/profile"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-[#5B403C] hover:text-ink"
      >
        <ChevronLeft className="size-4" /> Back to profile
      </Link>
      <h1 className="font-sora text-2xl font-semibold text-ink">Account Settings</h1>
      <ProfileInfo
        fullName={profile?.full_name ?? ""}
        email={session.email ?? ""}
        phone={profile?.phone}
        memberSince={profile?.created_at}
      />
    </div>
  );
}
