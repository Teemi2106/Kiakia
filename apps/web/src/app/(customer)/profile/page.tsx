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
import { ProfileWalletCard } from "./_components/ProfileWalletCard";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const query = (await searchParams).q?.trim().toLowerCase() ?? "";
  const session = await verifySession();
  const supabase = await createClient();

  const [{ data: profile }, { data: addresses }, { data: walletBalance }, { data: coinBalance }] = await Promise.all([
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
    supabase.rpc("get_wallet_balance"),
    supabase.rpc("get_kiakia_coin_balance"),
  ]);

  const matches = (...values: string[]) => values.some((value) => {
    const normalized = value.toLowerCase();
    return normalized.includes(query) || query.includes(normalized);
  });
  const showAccount = !query || matches("profile", "account", "name", "email", "phone", profile?.full_name ?? "", session.email ?? "", profile?.phone ?? "");
  const showSettings = !query || matches("settings", "address", "delivery", "location", "notification", "theme", "password", "preferences");
  const showSupport = !query || matches("help", "support", "faq", "contact", "question", "order", "payment", "delivery issue");
  const showLegal = !query || matches("legal", "privacy", "terms", "policy");
  const showWallet = !query || matches("wallet", "money", "coins", "kiaKia", "balance", "cashback", "funding");
  const showSignOut = !query || matches("sign out", "logout", "log out", "account");
  const hasResults = showAccount || showWallet || showSettings || showSupport || showLegal || showSignOut;

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-30 sm:px-6 sm:py-18">
      {/* Desktop Layout - Two Columns */}
      {hasResults ? (
      <>
      <div className="hidden flex-col gap-6 md:flex md:flex-row md:items-start md:gap-8">
        {/* Left Column */}
        <div className="flex w-full flex-col gap-6 md:w-[314.67px] md:shrink-0">
          {showAccount && <ProfileCard
            fullName={profile?.full_name ?? ""}
            email={session.email ?? ""}
            phone={profile?.phone}
            memberSince={profile?.created_at}
            avatarUrl={profile?.avatar_url}
            role="Customer"
          />}
          {showWallet && <ProfileWalletCard balanceKobo={walletBalance ?? 0} coins={coinBalance ?? 0} />}
          {showSettings && <SettingsNav />}
          {/* Sign Out Button - Desktop */}
          {showSignOut && <SignOutButton />}
        </div>

        {/* Right Column */}
        <div className="flex-1">
          <div className="rounded-2xl border border-kk-hair bg-kk-card p-6 shadow-sm">
            {showSupport && <><SupportSection /><FAQSection /></>}
            {showLegal && <MobileLegal />}
          </div>
        </div>
      </div>

      {/* Mobile Layout - Full Width */}
      <div className="flex flex-col gap-6 md:hidden">
        {showAccount && <ProfileCard
          fullName={profile?.full_name ?? ""}
          email={session.email ?? ""}
          phone={profile?.phone}
          memberSince={profile?.created_at}
          avatarUrl={profile?.avatar_url}
          role="Customer"
          variant="mobile"
        />}

        {showWallet && <ProfileWalletCard balanceKobo={walletBalance ?? 0} coins={coinBalance ?? 0} />}

        {showSettings && <MobileSettings addresses={addresses ?? []} />}
        {showSupport && <MobileHelp />}
        {showLegal && <MobileLegal />}

        {showSignOut && <div className="mt-4">
          <SignOutButton />
        </div>}
      </div>
      </>
      ) : (
        <div className="rounded-2xl border border-kk-line bg-kk-card p-8 text-center font-inter text-sm text-kk-cocoa">
          No profile sections match “{query}”.
        </div>
      )}
    </div>
  );
}
