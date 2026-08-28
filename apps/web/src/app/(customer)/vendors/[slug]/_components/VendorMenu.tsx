// app/(customer)/vendors/[slug]/_components/VendorMenu.tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import { CheckCircle2, AlertCircle, SearchX } from "lucide-react";
import { addToCart, updateCartItemQty } from "@/lib/cart";
import { createClient } from "@/lib/supabase/client";
import { useCart } from "@/app/(customer)/cart/_components/CartProvider";
import { VendorSidebar } from "./VendorSidebar";
import { CategoryNav } from "./CategoryNav";
import { MenuSearchBar } from "./MenuSearchBar";
import { MenuSection } from "./MenuSection";
import { ItemOptionsSheet } from "./ItemOptionsSheet";
import type { MenuCategory, MenuItem, VendorSummary } from "./types";

interface StatusMessage {
  text: string;
  tone: "success" | "error";
}

/** menu_item_id -> the one cart_items row for it (only meaningful for
 * no-option items — see handleAddClick's comment on why items with option
 * groups are deliberately excluded from this map). */
interface CartLine {
  cartItemId: string;
  qty: number;
}

/**
 * Pure fetch, no setState — which menu items (with no option groups, see
 * handleAddClick) already have a cart_items row for this vendor's open
 * cart, and its id/qty. Used both from an effect (mount/refreshKey change)
 * and imperatively after a mutation; kept state-free so calling it from
 * inside a `useEffect` body doesn't trip `react-hooks/set-state-in-effect`
 * the way passing a state-setting useCallback did.
 */
async function fetchCartLines(vendorId: string): Promise<Record<string, CartLine>> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return {};

  const { data: cart } = await supabase
    .from("carts")
    .select("id")
    .eq("customer_id", user.id)
    .eq("status", "open")
    .eq("vendor_id", vendorId)
    .maybeSingle();

  if (!cart) return {};

  const { data: items } = await supabase.from("cart_items").select("id, menu_item_id, qty, options_snapshot").eq("cart_id", cart.id);

  const lines: Record<string, CartLine> = {};
  for (const row of items ?? []) {
    // Only track items added with no customization — an item with
    // options_snapshot entries came from ItemOptionsSheet and may not be
    // the same configuration as a bare "+" tap would produce, so it's left
    // out of the stepper map and always re-opens the sheet.
    const hasOptions = Array.isArray(row.options_snapshot) && row.options_snapshot.length > 0;
    if (!row.menu_item_id || hasOptions) continue;
    lines[row.menu_item_id] = { cartItemId: row.id, qty: row.qty };
  }
  return lines;
}

export function VendorMenu({
  vendor,
  categories,
}: {
  vendor: VendorSummary;
  categories: readonly MenuCategory[];
}) {
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [addingItemId, setAddingItemId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [cartLines, setCartLines] = useState<Record<string, CartLine>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState("all");
  const { refreshCart, refreshKey } = useCart();

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

  useEffect(() => {
    let cancelled = false;
    fetchCartLines(vendor.id).then((lines) => {
      if (!cancelled) setCartLines(lines);
    });
    return () => {
      cancelled = true;
    };
  }, [vendor.id, refreshKey]);

  // Auto-dismiss the toast so it doesn't linger over the menu.
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  async function handleAdd(
    item: MenuItem,
    selectedOptionIds: readonly string[],
    qty: number,
  ) {
    const chosenOptions = item.optionGroups
      .flatMap((g) => g.options)
      .filter((o) => selectedOptionIds.includes(o.id));
    const unitPriceKobo =
      item.priceKobo +
      chosenOptions.reduce((sum, o) => sum + o.priceDeltaKobo, 0);

    setAddingItemId(item.id);
    const result = await addToCart({
      vendorId: vendor.id,
      menuItemId: item.id,
      name: item.name,
      unitPriceKobo,
      qty,
      options: chosenOptions.map((o) => ({
        optionId: o.id,
        name: o.name,
        priceDeltaKobo: o.priceDeltaKobo,
      })),
    });
    setAddingItemId(null);
    setActiveItem(null);

    if (!result.ok) {
      if (result.error !== "cancelled") {
        setStatus({ text: result.error, tone: "error" });
      }
      return;
    }

    setStatus({ text: `Added ${item.name} to your cart.`, tone: "success" });
    refreshCart();
    void fetchCartLines(vendor.id).then(setCartLines);
  }

  const handleAddClick = (item: MenuItem) => {
    if (item.optionGroups.length > 0) {
      // Items with option groups always reopen the sheet — a second tap
      // could pick different options, so there's no single "the" existing
      // line to increment (see fetchCartLines' comment).
      setActiveItem(item);
      return;
    }

    const existing = cartLines[item.id];
    if (existing) {
      void handleQtyChange(item, existing, existing.qty + 1);
    } else {
      void handleAdd(item, [], 1);
    }
  };

  async function handleQtyChange(item: MenuItem, existing: CartLine, nextQty: number) {
    setAddingItemId(item.id);
    const result = await updateCartItemQty(existing.cartItemId, nextQty);
    setAddingItemId(null);

    if (!result.ok) {
      setStatus({ text: result.error, tone: "error" });
      return;
    }

    refreshCart();
    void fetchCartLines(vendor.id).then(setCartLines);
  }

  const handleDecrementClick = (item: MenuItem) => {
    const existing = cartLines[item.id];
    if (!existing) return;
    void handleQtyChange(item, existing, existing.qty - 1);
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
                      addingItemId={addingItemId}
                      cartLines={cartLines}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status Toast */}
      {status && (
        <div
          className={`fixed bottom-24 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-white shadow-lg ${
            status.tone === "success" ? "bg-[#1C1B1B]" : "bg-[#BA1A1A]"
          }`}
          role="status"
        >
          {status.tone === "success" ? (
            <CheckCircle2 className="size-4 shrink-0" />
          ) : (
            <AlertCircle className="size-4 shrink-0" />
          )}
          {status.text}
        </div>
      )}

      {/* Item Options Sheet */}
      {activeItem && (
        <ItemOptionsSheet
          item={activeItem}
          onClose={() => setActiveItem(null)}
          onConfirm={(optionIds, qty) => handleAdd(activeItem, optionIds, qty)}
        />
      )}
    </div>
  );
}
