"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Badge } from "@kiakia/ui";
import { Plus, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { addToCart } from "@/lib/cart";
import { createClient } from "@/lib/supabase/client";
import { ItemOptionsSheet } from "./ItemOptionsSheet";
import type { MenuCategory, MenuItem, VendorSummary } from "./types";

interface CartSummary {
  readonly count: number;
  readonly totalKobo: number;
}

export function VendorMenu({ vendor, categories }: { vendor: VendorSummary; categories: readonly MenuCategory[] }) {
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [cart, setCart] = useState<CartSummary>({ count: 0, totalKobo: 0 });
  const [status, setStatus] = useState<string | null>(null);

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

      const { data: items } = await supabase.from("cart_items").select("qty, line_total_kobo").eq("cart_id", existingCart.id);
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

  async function handleAdd(item: MenuItem, selectedOptionIds: readonly string[], qty: number) {
    const chosenOptions = item.optionGroups
      .flatMap((g) => g.options)
      .filter((o) => selectedOptionIds.includes(o.id));
    const unitPriceKobo = item.priceKobo + chosenOptions.reduce((sum, o) => sum + o.priceDeltaKobo, 0);

    const result = await addToCart({
      vendorId: vendor.id,
      menuItemId: item.id,
      name: item.name,
      unitPriceKobo,
      qty,
      options: chosenOptions.map((o) => ({ optionId: o.id, name: o.name, priceDeltaKobo: o.priceDeltaKobo })),
    });

    setActiveItem(null);

    if (!result.ok) {
      if (result.error !== "cancelled") setStatus(result.error);
      return;
    }

    setCart((prev) => ({ count: prev.count + qty, totalKobo: prev.totalKobo + unitPriceKobo * qty }));
    setStatus(`Added ${item.name} to your cart.`);
  }

  return (
    <div className="flex flex-1 flex-col pb-24">
      <div
        className="h-40 w-full bg-surface-sunken bg-cover bg-center"
        style={vendor.bannerUrl ? { backgroundImage: `url(${vendor.bannerUrl})` } : undefined}
      />

      <div className="mx-auto -mt-10 w-full max-w-2xl px-4">
        <div className="rounded-card border border-border bg-surface-raised p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-xl font-semibold text-ink">{vendor.name}</h1>
            {!vendor.isAcceptingOrders && <Badge tone="danger">Currently closed</Badge>}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-ink-muted">
            {vendor.ratingCount > 0 && (
              <span className="flex items-center gap-1">
                <Star className="size-3.5 fill-warning text-warning" />
                {vendor.ratingAvg.toFixed(1)} ({vendor.ratingCount})
              </span>
            )}
            <span>~{vendor.avgPrepMins} min prep</span>
            {vendor.minOrderKobo > 0 && <span>Min. order {formatNaira(koboOf(vendor.minOrderKobo))}</span>}
          </div>
          {vendor.description && <p className="mt-2 text-sm text-ink-muted">{vendor.description}</p>}
        </div>

        {categories.length > 0 && (
          <div className="mt-4 flex gap-4 overflow-x-auto border-b border-border pb-2">
            {categories.map((category) => (
              <a
                key={category.id}
                href={`#category-${category.id}`}
                className="shrink-0 whitespace-nowrap text-sm font-medium text-ink-muted hover:text-brand-600"
              >
                {category.name}
              </a>
            ))}
          </div>
        )}

        {categories.length === 0 && <p className="mt-8 text-sm text-ink-muted">This vendor hasn&apos;t added a menu yet.</p>}

        {categories.map((category) => (
          <section key={category.id} id={`category-${category.id}`} className="mt-6 scroll-mt-20">
            <h2 className="text-base font-semibold text-ink">{category.name}</h2>
            <div className="mt-3 flex flex-col gap-3">
              {category.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-card border border-border bg-surface-raised p-3">
                  <div
                    className="size-16 shrink-0 rounded-control bg-surface-sunken bg-cover bg-center"
                    style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : undefined}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{item.name}</p>
                    {item.description && <p className="truncate text-xs text-ink-muted">{item.description}</p>}
                    <p className="mt-1 text-sm font-medium text-brand-600">{formatNaira(koboOf(item.priceKobo))}</p>
                  </div>
                  <button
                    type="button"
                    disabled={!item.isAvailable || !vendor.isAcceptingOrders}
                    onClick={() => setActiveItem(item)}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full border border-brand-500 text-brand-600 disabled:opacity-40"
                    aria-label={`Add ${item.name}`}
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {status && (
        <div className="fixed bottom-24 left-1/2 z-10 -translate-x-1/2 rounded-pill bg-ink px-4 py-2 text-xs text-ink-inverse shadow-lg">
          {status}
        </div>
      )}

      {cart.count > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-10 px-4">
          <Link
            href="/cart"
            className="mx-auto flex max-w-2xl items-center justify-between rounded-pill bg-brand-500 px-5 py-3 text-sm font-medium text-white shadow-lg"
          >
            <span>{cart.count} · View Cart</span>
            <span>{formatNaira(koboOf(cart.totalKobo))}</span>
          </Link>
        </div>
      )}

      {activeItem && (
        <ItemOptionsSheet
          item={activeItem}
          onClose={() => setActiveItem(null)}
          onConfirm={(optionIds, qty) => void handleAdd(activeItem, optionIds, qty)}
        />
      )}
    </div>
  );
}
