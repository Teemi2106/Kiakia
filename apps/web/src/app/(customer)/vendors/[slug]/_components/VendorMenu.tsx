// app/(customer)/vendors/[slug]/_components/VendorMenu.tsx
"use client";

import { useState, useMemo } from "react";
import { SearchX } from "lucide-react";
import { useCustomerStore } from "@/lib/customer/CustomerStoreProvider";
import { plainLineFor } from "@/lib/customer/store";
import { VendorSidebar } from "./VendorSidebar";
import { CategoryNav } from "./CategoryNav";
import { MenuSearchBar } from "./MenuSearchBar";
import { MenuSection } from "./MenuSection";
import { ItemOptionsSheet } from "./ItemOptionsSheet";
import type { MenuCategory, MenuItem, VendorSummary } from "./types";

export function VendorMenu({
  vendor,
  categories,
}: {
  vendor: VendorSummary;
  categories: readonly MenuCategory[];
}) {
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState("all");
  const lines = useCustomerStore((s) => s.lines);
  const cartVendorId = useCustomerStore((s) => s.cart?.vendorId);
  const addToCart = useCustomerStore((s) => s.addToCart);
  const setQty = useCustomerStore((s) => s.setQty);
  const notify = useCustomerStore((s) => s.notify);

  const visibleCategories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return categories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) => {
          if (!query) return true;
          return (
            item.name.toLowerCase().includes(query) ||
            (item.description ?? "").toLowerCase().includes(query)
          );
        }),
      }))
      .filter((category) => category.items.length > 0)
      .filter(
        (category) =>
          activeCategoryId === "all" || category.id === activeCategoryId,
      );
  }, [categories, searchQuery, activeCategoryId]);

  const hasAnyItems = categories.some((category) => category.items.length > 0);

  // The stepper tracks only this vendor's no-option lines (see plainLineFor).
  const qtyByItemId = useMemo(() => {
    const qty: Record<string, number> = {};
    if (cartVendorId !== vendor.id) return qty;
    for (const category of categories) {
      for (const item of category.items) {
        const line = plainLineFor(lines, item.id);
        if (line) qty[item.id] = line.qty;
      }
    }
    return qty;
  }, [lines, cartVendorId, vendor.id, categories]);

  // Both paths are optimistic: the cart and the stepper move on tap and the
  // write follows. A failure undoes the change and posts an error notice.
  async function handleAdd(
    item: MenuItem,
    selectedOptionIds: readonly string[],
    qty: number,
  ) {
    const chosenOptions = item.optionGroups
      .flatMap((g) => g.options)
      .filter((o) => selectedOptionIds.includes(o.id));

    const added = await addToCart({
      vendorId: vendor.id,
      vendorName: vendor.name,
      menuItemId: item.id,
      name: item.name,
      imageUrl: item.imageUrl,
      unitPriceKobo:
        item.priceKobo +
        chosenOptions.reduce((sum, o) => sum + o.priceDeltaKobo, 0),
      qty,
      options: chosenOptions.map((o) => ({
        optionId: o.id,
        name: o.name,
        priceDeltaKobo: o.priceDeltaKobo,
      })),
    });
    if (added) notify(`Added ${item.name} to your cart.`, "success");
  }

  const handleAddClick = (item: MenuItem) => {
    if (item.optionGroups.length > 0) {
      // Items with option groups always reopen the sheet — a second tap
      // could pick different options, so there's no single "the" existing
      // line to increment (see plainLineFor).
      setActiveItem(item);
      return;
    }

    const existing = cartVendorId === vendor.id ? plainLineFor(lines, item.id) : undefined;
    if (existing) void setQty(existing.id, existing.qty + 1);
    else void handleAdd(item, [], 1);
  };

  const handleDecrementClick = (item: MenuItem) => {
    const existing = plainLineFor(lines, item.id);
    if (existing) void setQty(existing.id, existing.qty - 1);
  };

  const nonEmptyCategories = categories.filter(
    (category) => category.items.length > 0,
  );

  return (
    <div className="flex flex-1 flex-col pb-24">
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* Sidebar */}
          <aside className="w-full shrink-0 lg:sticky lg:top-24 lg:w-[320px]">
            <VendorSidebar vendor={vendor} />
          </aside>

          {/* Menu column */}
          <div className="min-w-0 flex-1">
            {hasAnyItems && (
              <>
                <div className="mb-4">
                  <MenuSearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    vendorName={vendor.name}
                  />
                </div>
                <CategoryNav
                  categories={nonEmptyCategories}
                  activeId={activeCategoryId}
                  onSelect={setActiveCategoryId}
                />
              </>
            )}

            <div className="py-6">
              {!hasAnyItems ? (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#E4BEB8] bg-white p-10 text-center">
                  <p className="font-inter text-sm font-medium text-[#1C1B1B]">
                    This vendor hasn&apos;t added a menu yet.
                  </p>
                  <p className="max-w-sm font-inter text-sm text-[#5B403C]">
                    Check back soon — new items usually show up here shortly
                    after a store opens.
                  </p>
                </div>
              ) : visibleCategories.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#E4BEB8] bg-white p-10 text-center">
                  <SearchX className="size-6 text-[#5B403C]/50" />
                  <p className="font-inter text-sm font-medium text-[#1C1B1B]">
                    No items match &quot;{searchQuery}&quot;.
                  </p>
                  <p className="max-w-sm font-inter text-sm text-[#5B403C]">
                    Try a different search term or browse another category.
                  </p>
                </div>
              ) : (
                <div className="space-y-10">
                  {visibleCategories.map((category) => (
                    <MenuSection
                      key={category.id}
                      category={category}
                      onAddItem={handleAddClick}
                      onDecrementItem={handleDecrementClick}
                      qtyByItemId={qtyByItemId}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Item Options Sheet */}
      {activeItem && (
        <ItemOptionsSheet
          item={activeItem}
          onClose={() => setActiveItem(null)}
          onConfirm={(optionIds, qty) => {
            void handleAdd(activeItem, optionIds, qty);
            setActiveItem(null);
          }}
        />
      )}
    </div>
  );
}
