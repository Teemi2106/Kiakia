import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VendorMenu } from "./_components/VendorMenu";
import type { MenuCategory, MenuItem, VendorSummary } from "./_components/types";

// Flat queries + in-memory assembly, not a nested/embedded Supabase select
// — the generated Database type sets `Relationships: []` on every table
// (see packages/db/src/generated.ts's header) to avoid a TS instantiation
// bug, which means embedded selects wouldn't type-check the nested arrays
// correctly. This works either way; it's just more explicit.
export default async function VendorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: vendorRow } = await supabase
    .from("vendors")
    .select(
      "id, name, slug, category, description, banner_url, rating_avg, rating_count, avg_prep_mins, is_accepting_orders, min_order_kobo, status",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!vendorRow || vendorRow.status !== "active") {
    notFound();
  }

  const vendor: VendorSummary = {
    id: vendorRow.id,
    name: vendorRow.name,
    slug: vendorRow.slug,
    category: vendorRow.category,
    description: vendorRow.description,
    bannerUrl: vendorRow.banner_url,
    ratingAvg: vendorRow.rating_avg,
    ratingCount: vendorRow.rating_count,
    avgPrepMins: vendorRow.avg_prep_mins,
    isAcceptingOrders: vendorRow.is_accepting_orders,
    minOrderKobo: vendorRow.min_order_kobo,
  };

  const [{ data: categoryRows }, { data: itemRows }] = await Promise.all([
    supabase
      .from("menu_categories")
      .select("id, name, sort_order, is_active")
      .eq("vendor_id", vendor.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("menu_items")
      .select("id, category_id, name, description, image_url, price_kobo, is_available, sort_order")
      .eq("vendor_id", vendor.id)
      .order("sort_order"),
  ]);

  const itemIds = (itemRows ?? []).map((item) => item.id);

  const { data: groupRows } = itemIds.length
    ? await supabase
        .from("option_groups")
        .select("id, menu_item_id, name, min_select, max_select, is_required")
        .in("menu_item_id", itemIds)
    : { data: [] };

  const groupIds = (groupRows ?? []).map((group) => group.id);

  const { data: optionRows } = groupIds.length
    ? await supabase.from("options").select("id, group_id, name, price_delta_kobo, is_available").in("group_id", groupIds)
    : { data: [] };

  function toMenuItem(item: NonNullable<typeof itemRows>[number]): MenuItem {
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      imageUrl: item.image_url,
      priceKobo: item.price_kobo,
      isAvailable: item.is_available,
      optionGroups: (groupRows ?? [])
        .filter((group) => group.menu_item_id === item.id)
        .map((group) => ({
          id: group.id,
          name: group.name,
          minSelect: group.min_select,
          maxSelect: group.max_select,
          isRequired: group.is_required,
          options: (optionRows ?? [])
            .filter((option) => option.group_id === group.id)
            .map((option) => ({
              id: option.id,
              name: option.name,
              priceDeltaKobo: option.price_delta_kobo,
              isAvailable: option.is_available,
            })),
        })),
    };
  }

  const categories: MenuCategory[] = (categoryRows ?? []).map((category) => ({
    id: category.id,
    name: category.name,
    items: (itemRows ?? []).filter((item) => item.category_id === category.id).map(toMenuItem),
  }));

  // menu_items with no category (or a category that isn't active) still
  // need somewhere to render.
  const categorizedIds = new Set(categoryRows?.map((c) => c.id));
  const uncategorized = (itemRows ?? []).filter((item) => !item.category_id || !categorizedIds.has(item.category_id));
  if (uncategorized.length > 0) {
    categories.push({ id: "uncategorized", name: "Other", items: uncategorized.map(toMenuItem) });
  }

  return <VendorMenu vendor={vendor} categories={categories} />;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("vendors").select("name, description").eq("slug", slug).maybeSingle();

  return { title: data?.name ?? "Vendor", description: data?.description ?? undefined };
}
