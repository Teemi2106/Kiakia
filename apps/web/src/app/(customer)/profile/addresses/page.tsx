// app/(customer)/profile/addresses/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { AddressList } from "../_components/AddressList";

export const metadata: Metadata = { title: "Saved Addresses" };

export default async function ProfileAddressesPage() {
  const session = await verifySession();
  const supabase = await createClient();

  const { data: addresses } = await supabase
    .from("addresses")
    .select("id, label, line1, landmark, city, state, is_default")
    .eq("customer_id", session.userId)
    .order("is_default", { ascending: false });

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <Link
        href="/profile"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-[#5B403C] hover:text-ink"
      >
        <ChevronLeft className="size-4" /> Back to profile
      </Link>
      <h1 className="font-sora text-2xl font-semibold text-ink">Saved Addresses</h1>
      <AddressList addresses={addresses ?? []} />
    </div>
  );
}
