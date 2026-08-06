import type { Metadata } from "next";
import Link from "next/link";
import { getRoles, hasRole, verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { AddressList } from "./_components/AddressList";
import { ProfileInfo } from "./_components/ProfileInfo";
import { SignOutButton } from "./_components/SignOutButton";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const session = await verifySession();
  const roles = await getRoles();
  const isVendor = hasRole(roles, "vendor_staff", "vendor_manager", "vendor_owner");
  const supabase = await createClient();

  const [{ data: profile }, { data: addresses }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, avatar_url, created_at").eq("id", session.userId).single(),
    supabase
      .from("addresses")
      .select("id, label, line1, landmark, city, state, is_default")
      .eq("customer_id", session.userId)
      .order("is_default", { ascending: false }),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">Profile</h1>

      <ProfileInfo
        fullName={profile?.full_name ?? ""}
        email={session.email}
        phone={profile?.phone}
        memberSince={profile?.created_at}
      />

      <h2 className="mt-6 text-sm font-semibold text-ink">Saved Addresses</h2>
      <AddressList addresses={addresses ?? []} />

      <Link
        href={isVendor ? "/dashboard" : "/onboarding"}
        className="mt-6 block rounded-card border border-dashed border-border p-4 text-center text-sm font-medium text-brand-600 hover:border-brand-500"
      >
        {isVendor ? "Go to Vendor Dashboard →" : "Have a restaurant or store? Become a Vendor →"}
      </Link>

      <div className="mt-6">
        <SignOutButton />
      </div>
    </div>
  );
}
