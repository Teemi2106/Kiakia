import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@kiakia/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MenuItemForm } from "../../_components/MenuItemForm";

export const metadata: Metadata = { title: "New Menu Item" };

export default async function NewMenuItemPage() {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("menu_categories")
    .select("id, name")
    .eq("vendor_id", vendor.id)
    .order("sort_order");

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">New Menu Item</h1>
      <Card className="mt-4">
        <MenuItemForm vendorId={vendor.id} categories={categories ?? []} />
      </Card>
    </div>
  );
}
