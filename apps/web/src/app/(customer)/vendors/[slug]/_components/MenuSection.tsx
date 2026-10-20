// app/(customer)/vendors/[slug]/_components/MenuSection.tsx
"use client";

import { MenuItemCard } from "./MenuItemCard";
import type { MenuCategory, MenuItem } from "./types";

interface MenuSectionProps {
  category: MenuCategory;
  onAddItem: (item: MenuItem) => void;
  onDecrementItem: (item: MenuItem) => void;
  /** menu_item_id -> quantity of its no-option cart line. */
  qtyByItemId: Readonly<Record<string, number>>;
}

export function MenuSection({
  category,
  onAddItem,
  onDecrementItem,
  qtyByItemId,
}: MenuSectionProps) {
  if (category.items.length === 0) return null;

  return (
    <section id={`category-${category.id}`} className="scroll-mt-[120px]">
      <div className="mb-4 flex items-baseline gap-2">
        <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B] sm:text-2xl">
          {category.name}
        </h2>
        <span className="font-inter text-sm text-[#5B403C]">
          {category.items.length}{" "}
          {category.items.length === 1 ? "item" : "items"}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {category.items.map((item) => (
          <MenuItemCard
            key={item.id}
            item={item}
            onAdd={onAddItem}
            onDecrement={onDecrementItem}
            variant="desktop"
            qtyInCart={qtyByItemId[item.id] ?? 0}
          />
        ))}
      </div>
    </section>
  );
}
