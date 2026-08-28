// app/(vendor)/menu/_components/MenuMobile.tsx
"use client";

import { useState, useMemo } from "react";
import { Plus, Utensils } from "lucide-react";
import Link from "next/link";
import { cn } from "@kiakia/ui";
import { MenuCard } from "./MenuCard";
import { MenuFilters } from "./MenuFilters";
import { CategoryManager } from "./CategoryControls";
import type { MenuItem, Category } from "./types";
import { toggleItemAvailabilityAction } from "@/app/actions/menu";

interface MenuMobileProps {
  items: MenuItem[];
  categories: Category[];
  vendorId: string;
  isAcceptingOrders: boolean;
}

export function MenuMobile({
  items: initialItems,
  categories,
  vendorId,
  isAcceptingOrders,
}: MenuMobileProps) {
  const [items, setItems] = useState(initialItems);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");

  // Get unique category names for filters
  const categoryNames = useMemo(() => {
    return categories.map((c) => c.name);
  }, [categories]);

  // Filter items based on search and category
  const filteredItems = useMemo(() => {
    const activeCategoryId =
      activeFilter === "all"
        ? null
        : (categories.find((c) => c.name === activeFilter)?.id ?? null);

    return items.filter((item) => {
      // Search filter
      const matchesSearch = item.name
        .toLowerCase()
        .includes(searchQuery.toLowerCase());

      // Category filter
      const matchesFilter =
        activeFilter === "all" || item.category_id === activeCategoryId;

      return matchesSearch && matchesFilter;
    });
  }, [items, searchQuery, activeFilter, categories]);

  const handleToggleAvailability = async (
    itemId: string,
    isAvailable: boolean,
  ) => {
    // Update UI immediately
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, is_available: isAvailable } : item,
      ),
    );

    // Call server action
    await toggleItemAvailabilityAction(vendorId, itemId, isAvailable);
  };

  // Group items by category for display
  const groupedItems = filteredItems.reduce(
    (acc, item) => {
      const categoryId = item.category_id || "uncategorized";
      if (!acc[categoryId]) {
        acc[categoryId] = [];
      }
      acc[categoryId].push(item);
      return acc;
    },
    {} as Record<string, MenuItem[]>,
  );

  const getCategoryName = (categoryId: string) => {
    if (categoryId === "uncategorized") return "Other";
    return categories.find((c) => c.id === categoryId)?.name || "Other";
  };

  return (
    <div className="p-4 pb-24">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-sora text-2xl font-bold text-[#1C1B1B]">Menu</h1>
          <p className="text-sm text-[#5B403C]">
            {items.length} item{items.length === 1 ? "" : "s"}
          </p>
        </div>
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold",
            isAcceptingOrders
              ? "bg-[#176A22]/10 text-[#176A22]"
              : "bg-[#5B403C]/10 text-[#5B403C]",
          )}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isAcceptingOrders ? "bg-[#176A22] animate-pulse" : "bg-[#5B403C]",
            )}
          />
          {isAcceptingOrders ? "Accepting Orders" : "Closed"}
        </span>
      </div>

      {/* Filters */}
      <MenuFilters
        categories={categoryNames}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        onSearch={setSearchQuery}
      />

      {/* Menu Items Grid */}
      <div className="mt-6 space-y-8">
        {Object.entries(groupedItems).map(([categoryId, categoryItems]) => (
          <section key={categoryId}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
                {getCategoryName(categoryId)}
              </h2>
              <span className="rounded-full bg-[rgba(182,25,19,0.1)] px-3 py-1 text-xs font-medium text-[#B61913]">
                {categoryItems.length} Item{categoryItems.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {categoryItems.map((item) => (
                <MenuCard
                  key={item.id}
                  item={item}
                  vendorId={vendorId}
                  onToggleAvailability={handleToggleAvailability}
                />
              ))}
            </div>
          </section>
        ))}

        {filteredItems.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#E4BEB8] py-12 text-center">
            <Utensils className="size-8 text-[#5B403C]/30" />
            <p className="font-medium text-[#1C1B1B]">No menu items found</p>
            <p className="text-sm text-[#5B403C]">
              Try a different search or filter.
            </p>
          </div>
        )}
      </div>

      <div className="mt-8">
        <CategoryManager vendorId={vendorId} categories={categories} />
      </div>

      {/* FAB - Add New Item */}
      <Link
        href="/dashboard/menu/items/new"
        className="fixed bottom-24 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#B61913] text-white shadow-xl transition-transform hover:scale-105 active:scale-90"
      >
        <Plus className="size-8" />
      </Link>
    </div>
  );
}
