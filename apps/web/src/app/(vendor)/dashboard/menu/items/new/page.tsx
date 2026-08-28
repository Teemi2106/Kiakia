import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MenuItemForm } from "../../_components/MenuItemForm";

export const metadata: Metadata = { title: "New Menu Item" };

export default async function NewMenuItemPage() {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 lg:px-6">
      <Link
        href="/dashboard/menu"
        className="inline-flex items-center gap-1 text-sm font-medium text-[#5B403C] transition-colors hover:text-[#B61913]"
      >
        <ChevronLeft className="size-4" />
        Back to menu
      </Link>
      <h1 className="mt-3 font-sora text-2xl font-bold text-[#1C1B1B] lg:text-3xl">
        New Menu Item
      </h1>
      <p className="mt-1 text-sm text-[#5B403C]">
        Add a dish to your menu so customers can order it.
      </p>
      <div className="mt-6 rounded-2xl border border-[#E4BEB8] bg-white p-6 shadow-sm">
        <MenuItemForm vendorId={vendor.id} />
      </div>
    </div>
  );
}
