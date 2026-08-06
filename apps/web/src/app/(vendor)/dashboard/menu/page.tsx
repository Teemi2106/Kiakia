import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatNaira, koboOf } from "@kiakia/domain";
import { EmptyState, buttonVariants } from "@kiakia/ui";
import { Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddCategoryForm, DeleteCategoryButton } from "./_components/CategoryControls";
import { AvailabilityToggle, DeleteItemButton } from "./_components/MenuItemRowActions";

export const metadata: Metadata = { title: "Menu Management" };

export default async function VendorMenuPage() {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  const supabase = await createClient();
  const [{ data: categories }, { data: items }] = await Promise.all([
    supabase.from("menu_categories").select("id, name, sort_order").eq("vendor_id", vendor.id).order("sort_order"),
    supabase
      .from("menu_items")
      .select("id, name, category_id, price_kobo, is_available, sort_order")
      .eq("vendor_id", vendor.id)
      .order("sort_order"),
  ]);

  const uncategorizedItems = (items ?? []).filter(
    (item) => !item.category_id || !categories?.some((c) => c.id === item.category_id),
  );

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">Menu Management</h1>
        <Link href="/dashboard/menu/items/new" className={buttonVariants({ variant: "primary", size: "sm" })}>
          + New Item
        </Link>
      </div>

      {!items || items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No menu items yet"
            description="Add your first item to start accepting orders."
            action={
              <Link href="/dashboard/menu/items/new" className={buttonVariants({ variant: "primary" })}>
                Add item
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {(categories ?? []).map((category) => {
            const categoryItems = (items ?? []).filter((item) => item.category_id === category.id);
            return (
              <section key={category.id}>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-ink">{category.name}</h2>
                  <DeleteCategoryButton vendorId={vendor.id} categoryId={category.id} />
                </div>
                <MenuItemRows vendorId={vendor.id} items={categoryItems} />
              </section>
            );
          })}

          {uncategorizedItems.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-ink">Other</h2>
              <MenuItemRows vendorId={vendor.id} items={uncategorizedItems} />
            </section>
          )}
        </div>
      )}

      <div className="mt-6">
        <AddCategoryForm vendorId={vendor.id} />
      </div>
    </div>
  );
}

function MenuItemRows({
  vendorId,
  items,
}: {
  vendorId: string;
  items: readonly { id: string; name: string; price_kobo: number; is_available: boolean }[];
}) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 rounded-card border border-border bg-surface-raised p-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">{item.name}</p>
            <p className="text-sm text-ink-muted">{formatNaira(koboOf(item.price_kobo))}</p>
          </div>
          <AvailabilityToggle vendorId={vendorId} itemId={item.id} initialValue={item.is_available} />
          <Link href={`/dashboard/menu/items/${item.id}/edit`} className="text-ink-muted hover:text-ink" aria-label="Edit item">
            <Pencil className="size-4" />
          </Link>
          <DeleteItemButton vendorId={vendorId} itemId={item.id} />
        </div>
      ))}
    </div>
  );
}
