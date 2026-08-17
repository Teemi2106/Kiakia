// app/(customer)/vendors/[slug]/_components/VendorMenu.tsx
"use client";

import { useState, useEffect } from "react";
import { addToCart } from "@/lib/cart";
import { createClient } from "@/lib/supabase/client";
import { VendorHero } from "./VendorHero";
import { CategoryNav } from "./CategoryNav";
import { MenuSection } from "./MenuSection";
import { ItemOptionsSheet } from "./ItemOptionsSheet";
import type { MenuCategory, MenuItem, VendorSummary } from "./types";

interface CartSummary {
  count: number;
  totalKobo: number;
}

export function VendorMenu({
  vendor,
  categories,
}: {
  vendor: VendorSummary;
  categories: readonly MenuCategory[];
}) {
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [cart, setCart] = useState<CartSummary>({ count: 0, totalKobo: 0 });
  const [status, setStatus] = useState<string | null>(null);

  // Load existing cart on mount
  useEffect(() => {
    let cancelled = false;

    async function loadExistingCart() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: existingCart } = await supabase
        .from("carts")
        .select("id")
        .eq("customer_id", user.id)
        .eq("vendor_id", vendor.id)
        .eq("status", "open")
        .maybeSingle();
      if (!existingCart) return;

      const { data: items } = await supabase
        .from("cart_items")
        .select("qty, line_total_kobo")
        .eq("cart_id", existingCart.id);
      if (cancelled || !items) return;

      setCart({
        count: items.reduce((sum, i) => sum + i.qty, 0),
        totalKobo: items.reduce((sum, i) => sum + i.line_total_kobo, 0),
      });
    }

    void loadExistingCart();
    return () => {
      cancelled = true;
    };
  }, [vendor.id]);

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

    setActiveItem(null);

    if (!result.ok) {
      if (result.error !== "cancelled") setStatus(result.error);
      return;
    }

    setCart((prev) => ({
      count: prev.count + qty,
      totalKobo: prev.totalKobo + unitPriceKobo * qty,
    }));
    setStatus(`Added ${item.name} to your cart.`);
  }

  const handleAddClick = (item: MenuItem) => {
    if (item.optionGroups.length > 0) {
      setActiveItem(item);
    } else {
      // No options, add directly with qty 1
      void handleAdd(item, [], 1);
    }
  };

  return (
    <div className="flex flex-1 flex-col pb-24">
      {/* Hero Section */}
      <VendorHero vendor={vendor} />

      {/* Category Navigation */}
      <CategoryNav categories={categories} />

      {/* Menu Content */}
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {categories.length === 0 ? (
          <p className="mt-8 text-center text-sm text-[#5B403C]">
            This vendor hasn&apos;t added a menu yet.
          </p>
        ) : (
          <div className="space-y-12">
            {categories.map((category) => (
              <MenuSection
                key={category.id}
                category={category}
                onAddItem={handleAddClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Status Toast */}
      {status && (
        <div className="fixed bottom-24 left-1/2 z-10 -translate-x-1/2 rounded-full bg-[#1C1B1B] px-4 py-2 text-xs text-white shadow-lg">
          {status}
        </div>
      )}

      {/* Item Options Sheet */}
      {activeItem && (
        <ItemOptionsSheet
          item={activeItem}
          onClose={() => setActiveItem(null)}
          onConfirm={(optionIds, qty) =>
            void handleAdd(activeItem, optionIds, qty)
          }
        />
      )}
    </div>
  );
}
