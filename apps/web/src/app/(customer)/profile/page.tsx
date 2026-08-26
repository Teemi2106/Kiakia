// app/(customer)/profile/page.tsx
import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { ProfileCard } from "./_components/ProfileCard";
import { SettingsNav } from "./_components/SettingsNav";
import { SupportSection } from "./_components/SupportSection";
import { FAQSection } from "./_components/FAQSection";
import { MobileSettings } from "./_components/MobileSettings";
import { MobileHelp } from "./_components/MobileHelp";
import { MobileLegal } from "./_components/MobileLegal";
import { SignOutButton } from "./_components/SignOutButton";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const session = await verifySession();
  const supabase = await createClient();

  const [{ data: profile }, { data: addresses }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, phone, avatar_url, created_at")
      .eq("id", session.userId)
      .single(),
    supabase
      .from("addresses")
      .select("id, label, line1, landmark, city, state, is_default")
      .eq("customer_id", session.userId)
      .order("is_default", { ascending: false }),
  ]);

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-30 sm:px-6 sm:py-18">
      {/* Desktop Layout - Two Columns */}
      <div className="hidden flex-col gap-6 md:flex md:flex-row md:items-start md:gap-8">
        {/* Left Column */}
        <div className="flex w-full flex-col gap-6 md:w-[314.67px] md:shrink-0">
          <ProfileCard
            fullName={profile?.full_name ?? ""}
            email={session.email ?? ""}
            phone={profile?.phone}
            memberSince={profile?.created_at}
            avatarUrl={profile?.avatar_url}
            role="Customer"
          />
          // if you make the pages then uncomment the settings
          {/* <SettingsNav /> */}
          {/* Sign Out Button - Desktop */}
          <SignOutButton />
        </div>

        {/* Right Column */}
        <div className="flex-1">
          <div className="rounded-2xl border border-[#E5E2E1] bg-white p-6 shadow-sm">
            <SupportSection />
            <FAQSection />
          </div>
        </div>
      </div>

      {/* Mobile Layout - Full Width */}
      <div className="flex flex-col gap-6 md:hidden">
        <ProfileCard
          fullName={profile?.full_name ?? ""}
          email={session.email ?? ""}
          phone={profile?.phone}
          memberSince={profile?.created_at}
          avatarUrl={profile?.avatar_url}
          role="Customer"
          variant="mobile"
        />

        <MobileSettings addresses={addresses ?? []} />
        <MobileHelp />
        <MobileLegal />

        <div className="mt-4">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
