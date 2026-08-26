// app/(vendor)/menu/page.tsx
import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, buttonVariants } from "@kiakia/ui";
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
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-ink">Menu Management</h1>
          <Link
            href="/dashboard/menu/items/new"
            className={buttonVariants({ variant: "primary", size: "sm" })}
          >
            + New Item
          </Link>
        </div>
        <div className="mt-6">
          <EmptyState
            title="No menu items yet"
            description="Add your first item to start accepting orders."
            action={
              <Link
                href="/dashboard/menu/items/new"
                className={buttonVariants({ variant: "primary" })}
              >
                Add item
              </Link>
            }
          />
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
        />
      </div>
      <div className="lg:hidden">
        <MenuMobile
          items={items}
          categories={categories}
          vendorId={vendor.id}
        />
      </div>
    </>
  );
}
