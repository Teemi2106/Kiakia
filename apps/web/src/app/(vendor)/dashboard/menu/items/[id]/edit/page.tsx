import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@kiakia/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MenuItemForm } from "../../../_components/MenuItemForm";
import type { OptionGroupState } from "../../../_components/OptionGroupsBuilder";

export const metadata: Metadata = { title: "Edit Menu Item" };

export default async function EditMenuItemPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  const { id } = await params;
  const supabase = await createClient();

  const [{ data: item }, { data: categories }] = await Promise.all([
    supabase
      .from("menu_items")
      .select("id, vendor_id, name, description, image_url, price_kobo, category_id, is_available")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("menu_categories").select("id, name").eq("vendor_id", vendor.id).order("sort_order"),
  ]);

  if (!item || item.vendor_id !== vendor.id) notFound();

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
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">Edit Menu Item</h1>
      <Card className="mt-4">
        <MenuItemForm
          vendorId={vendor.id}
          categories={categories ?? []}
          existingItem={{
            id: item.id,
            name: item.name,
            description: item.description,
            imageUrl: item.image_url,
            priceKobo: item.price_kobo,
            categoryId: item.category_id,
            isAvailable: item.is_available,
            optionGroups,
          }}
        />
      </Card>
    </div>
  );
}
