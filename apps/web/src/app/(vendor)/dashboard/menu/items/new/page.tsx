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
        className="inline-flex items-center gap-1 text-sm font-medium text-kk-cocoa transition-colors hover:text-kk-red-ink"
      >
        <ChevronLeft className="size-4" />
        Back to menu
      </Link>
      <h1 className="mt-3 font-sora text-2xl font-bold text-kk-ink lg:text-3xl">
        New Menu Item
      </h1>
      <p className="mt-1 text-sm text-kk-cocoa">
        Add a dish to your menu so customers can order it.
      </p>
      <div className="mt-6 rounded-2xl border border-kk-line bg-kk-card p-6 shadow-sm">
        <MenuItemForm vendorId={vendor.id} commissionBps={vendor.commission_bps} />
      </div>
    </div>
  );
}
