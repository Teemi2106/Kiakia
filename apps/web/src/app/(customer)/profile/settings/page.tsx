// app/(customer)/profile/settings/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { loadMarketingPreferences } from "@/lib/messaging/preferences";
import { MarketingPreferences } from "@/app/_components/MarketingPreferences";
import { ThemeToggle } from "@/app/_components/ThemeToggle";
import { getTheme } from "@/lib/theme";
import { ProfileInfo } from "../_components/ProfileInfo";

export const metadata: Metadata = { title: "Account Settings" };

export default async function ProfileSettingsPage() {
  const session = await verifySession();
  const supabase = await createClient();

  const theme = await getTheme();
  const [{ data: profile }, marketing] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, created_at").eq("id", session.userId).single(),
    loadMarketingPreferences(session.userId),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-30 sm:px-6 sm:py-18">
      <Link
        href="/profile"
        className="inline-flex items-center gap-1 font-inter text-sm font-medium text-kk-cocoa hover:text-kk-ink"
      >
        <ChevronLeft className="size-4" /> Back to profile
      </Link>
      <h1 className="mt-4 font-sora text-2xl font-semibold text-kk-ink sm:text-[28px]">Account Settings</h1>
      <p className="mt-1 font-inter text-sm text-kk-cocoa">
        Update your name and review the contact details on your account.
      </p>
      <ProfileInfo
        fullName={profile?.full_name ?? ""}
        email={session.email ?? ""}
        phone={profile?.phone}
        memberSince={profile?.created_at}
      />
      <section className="mt-6 rounded-3xl border border-kk-line/60 bg-kk-card p-5 sm:p-6">
        <h2 className="font-sora text-base font-semibold text-kk-ink">Appearance</h2>
        <p className="mt-1 font-inter text-sm text-kk-cocoa">Choose light or dark, or follow your device.</p>
        <div className="mt-3 max-w-xs">
          <ThemeToggle theme={theme} />
        </div>
      </section>
      <MarketingPreferences initial={marketing} />
    </div>
  );
}
