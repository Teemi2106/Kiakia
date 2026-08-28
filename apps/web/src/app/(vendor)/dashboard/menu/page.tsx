// app/(vendor)/menu/page.tsx
import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { Plus, Utensils } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MenuDesktop } from "./_components/MenuDesktop";
import { MenuMobile } from "./_components/MenuMobile";

export const metadata = { title: "Menu Management" };

export default async function VendorMenuPage() {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  const supabase = await createClient();

  const [{ data: categoryData }, { data: itemData }] = await Promise.all([
    supabase
      .from("menu_categories")
      .select("id, name, sort_order")
      .eq("vendor_id", vendor.id)
      .order("sort_order"),
    supabase
      .from("menu_items")
      .select(
        "id, name, category_id, price_kobo, is_available, sort_order, image_url, description",
      )
      .eq("vendor_id", vendor.id)
      .order("sort_order"),
  ]);

  const categories = categoryData ?? [];
  const items = itemData ?? [];

  if (items.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="font-sora text-2xl font-bold text-[#1C1B1B]">
            Menu Management
          </h1>
          <Link
            href="/dashboard/menu/items/new"
            className="flex items-center gap-2 rounded-xl bg-[#B61913] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#9e1611]"
          >
            <Plus className="size-4" />
            New Item
          </Link>
        </div>
        <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#E4BEB8] bg-white p-12 text-center">
          <Utensils className="size-8 text-[#5B403C]/30" />
          <p className="font-medium text-[#1C1B1B]">No menu items yet</p>
          <p className="max-w-sm text-sm text-[#5B403C]">
            Add your first item to start accepting orders.
          </p>
          <Link
            href="/dashboard/menu/items/new"
            className="mt-2 flex items-center gap-2 rounded-xl bg-[#B61913] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#9e1611]"
          >
            <Plus className="size-4" />
            Add item
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="hidden lg:block">
        <MenuDesktop
          items={items}
          categories={categories}
          vendorId={vendor.id}
          isAcceptingOrders={vendor.is_accepting_orders}
        />
      </div>
      <div className="lg:hidden">
        <MenuMobile
          items={items}
          categories={categories}
          vendorId={vendor.id}
          isAcceptingOrders={vendor.is_accepting_orders}
        />
      </div>
    </>
  );
}
