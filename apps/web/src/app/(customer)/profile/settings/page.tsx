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
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-30 sm:px-6 sm:py-18">
      <Link
        href="/profile"
        className="inline-flex items-center gap-1 font-inter text-sm font-medium text-[#5B403C] hover:text-[#1C1B1B]"
      >
        <ChevronLeft className="size-4" /> Back to profile
      </Link>
      <h1 className="mt-4 font-sora text-2xl font-semibold text-[#1C1B1B] sm:text-[28px]">Account Settings</h1>
      <p className="mt-1 font-inter text-sm text-[#5B403C]">
        Update your name and review the contact details on your account.
      </p>
      <ProfileInfo
        fullName={profile?.full_name ?? ""}
        email={session.email ?? ""}
        phone={profile?.phone}
        memberSince={profile?.created_at}
      />
    </div>
  );
}
