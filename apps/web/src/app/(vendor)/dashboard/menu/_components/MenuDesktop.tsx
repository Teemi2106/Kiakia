// app/(vendor)/menu/_components/MenuDesktop.tsx
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Utensils } from "lucide-react";
import { buttonVariants, cn } from "@kiakia/ui";
import { MenuFilters } from "./MenuFilters";
import { MenuTable } from "./MenuTable";
import { CategoryManager } from "./CategoryControls";
import { toggleItemAvailabilityAction } from "@/app/actions/menu";
import type { MenuItem, Category } from "./types";

interface MenuDesktopProps {
  items: MenuItem[];
  categories: Category[];
  vendorId: string;
  isAcceptingOrders: boolean;
}

export function MenuDesktop({
  items: initialItems,
  categories,
  vendorId,
  isAcceptingOrders,
}: MenuDesktopProps) {
  const [items, setItems] = useState(initialItems);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");

  const categoryNames = useMemo(() => {
    return categories.map((c) => c.name);
  }, [categories]);

  const filteredItems = useMemo(() => {
    const activeCategoryId =
      activeFilter === "all"
        ? null
        : (categories.find((c) => c.name === activeFilter)?.id ?? null);

    return items.filter((item) => {
      const matchesSearch = item.name
        .toLowerCase()
        .includes(searchQuery.toLowerCase());

      const matchesFilter =
        activeFilter === "all" || item.category_id === activeCategoryId;

      return matchesSearch && matchesFilter;
    });
  }, [items, searchQuery, activeFilter, categories]);

  const handleToggleAvailability = async (
    itemId: string,
    isAvailable: boolean,
  ) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, is_available: isAvailable } : item,
      ),
    );
    await toggleItemAvailabilityAction(vendorId, itemId, isAvailable);
  };

  return (
    <div className="p-6">
      {/* Stats & Actions */}
      <div className="mb-6 grid grid-cols-12 gap-6">
        <div className="col-span-8 flex flex-col gap-4 rounded-2xl border border-[#E4BEB8] bg-white p-6 shadow-sm md:flex-row md:items-center">
          <MenuFilters
            categories={categoryNames}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            onSearch={setSearchQuery}
          />
        </div>

        <div
          className={cn(
            "col-span-4 relative overflow-hidden rounded-2xl p-6 text-white",
            isAcceptingOrders ? "bg-[#176A22]" : "bg-[#5B403C]",
          )}
        >
          <div className="relative z-10">
            <p className="text-sm font-medium opacity-90">Kitchen Status</p>
            <h3 className="mt-1 font-sora text-2xl font-bold">
              {isAcceptingOrders ? "Live & Active" : "Closed"}
            </h3>
          </div>
          <div className="relative z-10 mt-4 flex items-center gap-2">
            <span
              className={cn(
                "h-3 w-3 rounded-full bg-white",
                isAcceptingOrders && "animate-pulse",
              )}
            />
            <span className="text-sm font-medium">
              {isAcceptingOrders ? "Accepting Orders" : "Not Accepting Orders"}
            </span>
          </div>
          <span className="absolute -right-4 -bottom-4 text-9xl opacity-10 rotate-12">
            🍽️
          </span>
        </div>
      </div>

      {/* Menu Table */}
      <div className="overflow-hidden rounded-2xl border border-[#E4BEB8] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[#E4BEB8] bg-[#F6F3F2] p-6">
          <h3 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
            Menu Items
          </h3>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/menu/items/new"
              className={cn(
                buttonVariants({ variant: "primary" }),
                "flex items-center gap-2 rounded-xl bg-[#B61913] px-6 py-3 text-sm font-bold text-white transition-all hover:bg-[#9e1611]",
              )}
            >
              <span className="text-lg">+</span>
              New Item
            </Link>
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <Utensils className="size-8 text-[#5B403C]/30" />
            <p className="font-medium text-[#1C1B1B]">No menu items found</p>
            <p className="text-sm text-[#5B403C]">
              Try a different search or filter.
            </p>
          </div>
        ) : (
          <MenuTable
            items={filteredItems}
            categories={categories}
            vendorId={vendorId}
            onToggleAvailability={handleToggleAvailability}
          />
        )}

        <div className="flex items-center justify-between border-t border-[#E4BEB8] bg-[#F6F3F2] p-4">
          <p className="text-sm text-[#5B403C]">
            Showing {filteredItems.length} of {items.length} items
          </p>
        </div>
      </div>

      <div className="mt-6">
        <CategoryManager vendorId={vendorId} categories={categories} />
      </div>
    </div>
  );
}
