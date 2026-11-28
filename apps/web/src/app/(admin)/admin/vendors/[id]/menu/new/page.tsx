import { getVendorDetail } from "@/lib/admin/vendors";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MenuItemForm } from "@/app/(vendor)/dashboard/menu/_components/MenuItemForm";
import { buttonVariants } from "@kiakia/ui";

export const metadata: Metadata = { title: "Add vendor menu item" };

export default async function AdminNewVendorMenuItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ added?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const detail = await getVendorDetail(id);
  if (!detail) notFound();
  const added = query.added === "1" || (Array.isArray(query.added) && query.added.includes("1"));
  const menuItemCount = detail.menu.categories.reduce((total, category) => total + category.items.length, 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link href={`/admin/vendors/${detail.vendor.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
        Back to {detail.vendor.name}
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-ink">Add a menu item for {detail.vendor.name}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          The menu has {menuItemCount} {menuItemCount === 1 ? "item" : "items"}. Add the dish details, price, photo, and any choices customers can make. If the store is awaiting approval, customers won&apos;t see its menu until it is approved.
        </p>
      </div>
      {added && (
        <p role="status" className="rounded-control bg-positive-surface px-3 py-2 text-sm font-medium text-ink">
          Menu item added. You can add another or return to the vendor page.
        </p>
      )}
      <div className="rounded-card border border-border bg-surface-raised p-5 sm:p-6">
        <MenuItemForm vendorId={detail.vendor.id} commissionBps={detail.vendor.commission_bps} adminMode />
      </div>
    </div>
  );
}
