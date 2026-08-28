import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MenuItemForm } from "../../../_components/MenuItemForm";
import type { OptionGroupState } from "../../../_components/OptionGroupsBuilder";

export const metadata: Metadata = { title: "Edit Menu Item" };

export default async function EditMenuItemPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  const { id } = await params;
  const supabase = await createClient();

  const { data: item } = await supabase
    .from("menu_items")
    .select("id, vendor_id, name, description, image_url, price_kobo, category_id, is_available")
    .eq("id", id)
    .maybeSingle();

  if (!item || item.vendor_id !== vendor.id) notFound();

  // The form picks a category by preset key (MenuItemForm.tsx), not by
  // menu_categories.id, so resolve the item's current category row to its
  // key here rather than passing every one of the vendor's category rows down.
  const { data: currentCategory } = item.category_id
    ? await supabase.from("menu_categories").select("category_key").eq("id", item.category_id).maybeSingle()
    : { data: null };

  const { data: groupRows } = await supabase
    .from("option_groups")
    .select("id, name, min_select, max_select, is_required")
    .eq("menu_item_id", item.id);

  const groupIds = (groupRows ?? []).map((g) => g.id);
  const { data: optionRows } = groupIds.length
    ? await supabase.from("options").select("id, group_id, name, price_delta_kobo").in("group_id", groupIds)
    : { data: [] };

  const optionGroups: OptionGroupState[] = (groupRows ?? []).map((group) => ({
    name: group.name,
    minSelect: group.min_select,
    maxSelect: group.max_select,
    isRequired: group.is_required,
    options: (optionRows ?? [])
      .filter((option) => option.group_id === group.id)
      .map((option) => ({ name: option.name, priceDeltaNaira: option.price_delta_kobo / 100 })),
  }));

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
        Edit {item.name}
      </h1>
      <p className="mt-1 text-sm text-[#5B403C]">
        Update the details customers see on this item.
      </p>
      <div className="mt-6 rounded-2xl border border-[#E4BEB8] bg-white p-6 shadow-sm">
        <MenuItemForm
          vendorId={vendor.id}
          existingItem={{
            id: item.id,
            name: item.name,
            description: item.description,
            imageUrl: item.image_url,
            priceKobo: item.price_kobo,
            categoryKey: currentCategory?.category_key ?? null,
            isAvailable: item.is_available,
            optionGroups,
          }}
        />
      </div>
    </div>
  );
}
