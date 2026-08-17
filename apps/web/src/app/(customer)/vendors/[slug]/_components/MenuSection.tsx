// app/(customer)/vendors/[slug]/_components/MenuSection.tsx
"use client";

import { MenuItemCard } from "./MenuItemCard";
import type { MenuCategory, MenuItem } from "./types";

interface MenuSectionProps {
  category: MenuCategory;
  onAddItem: (item: MenuItem) => void;
}

export function MenuSection({ category, onAddItem }: MenuSectionProps) {
  if (category.items.length === 0) return null;

  return (
    <section id={`category-${category.id}`} className="scroll-mt-[120px]">
      <h2 className="mb-4 font-sora text-2xl font-semibold text-[#1C1B1B] sm:text-2xl">
        {category.name}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {category.items.map((item) => (
          <MenuItemCard
            key={item.id}
            item={item}
            onAdd={onAddItem}
            variant="desktop"
          />
        ))}
      </div>
    </section>
  );
}
