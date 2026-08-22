// app/(vendor)/menu/page.tsx
import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, buttonVariants } from "@kiakia/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MenuDesktop } from "./_components/MenuDesktop";
import { MenuMobile } from "./_components/MenuMobile";
import type { MenuItem, Category } from "./_components/types";

export const metadata = { title: "Menu Management" };

// Demo data for when no real data exists
const DEMO_CATEGORIES: Category[] = [
  { id: "cat-1", name: "Rice", sort_order: 0 },
  { id: "cat-2", name: "Swallow", sort_order: 1 },
  { id: "cat-3", name: "Sides", sort_order: 2 },
];

const DEMO_ITEMS: MenuItem[] = [
  {
    id: "item-1",
    name: "Smokey Party Jollof Rice",
    category_id: "cat-1",
    price_kobo: 350000,
    is_available: true,
    sort_order: 0,
    image_url: null,
    description:
      "Authentic firewood taste served with grilled chicken and dodo.",
  },
  {
    id: "item-2",
    name: "Pounded Yam & Egusi",
    category_id: "cat-2",
    price_kobo: 480000,
    is_available: true,
    sort_order: 0,
    image_url: null,
    description:
      "Freshly pounded yam with rich Egusi soup containing stockfish and tripe.",
  },
  {
    id: "item-3",
    name: "Extra Sweet Dodo",
    category_id: "cat-3",
    price_kobo: 120000,
    is_available: true,
    sort_order: 0,
    image_url: null,
    description: "Perfectly fried, sweet and golden ripe plantains.",
  },
  {
    id: "item-4",
    name: "Catfish Pepper Soup",
    category_id: "cat-3",
    price_kobo: 280000,
    is_available: false,
    sort_order: 1,
    image_url: null,
    description:
      "Spicy and comforting catfish soup infused with traditional local spices.",
  },
];

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

  const categories = categoryData?.length ? categoryData : DEMO_CATEGORIES;
  const items = itemData?.length ? itemData : DEMO_ITEMS;

  // Helper function to update item availability (will be passed to client components)
  // This will be handled by server actions when the toggle is clicked

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
