// app/(customer)/vendors/[slug]/_components/CategoryNav.tsx
"use client";

import { cn } from "@kiakia/ui";
import { HorizontalScrollIndicators } from "../../../_components/HorizontalScrollIndicators";

interface CategoryNavProps {
  categories: readonly { id: string; name: string }[];
  activeId: string;
  onSelect: (id: string) => void;
}

/** A filter tab bar, not a scroll-spy — selecting a tab (or "All") narrows
 * which category sections render below, matching the reference's
 * underlined-active-tab behavior rather than jumping the page to an anchor. */
export function CategoryNav({ categories, activeId, onSelect }: CategoryNavProps) {
  if (categories.length === 0) return null;

  const tabs = [{ id: "all", name: "All" }, ...categories];

  return (
    <div className="sticky top-[56px] z-30 border-b border-kk-hair bg-kk-cream/95 backdrop-blur-sm sm:top-[63px]">
      <div id="vendor-category-tabs-rail" className="flex gap-6 overflow-x-auto px-1 [-webkit-overflow-scrolling:touch]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            aria-current={activeId === tab.id}
            className={cn(
              "shrink-0 whitespace-nowrap border-b-2 px-1 py-3 font-inter text-sm font-semibold transition-colors",
              activeId === tab.id
                ? "border-kk-red text-kk-red-ink"
                : "border-transparent text-kk-cocoa hover:text-kk-ink",
            )}
          >
            {tab.name}
          </button>
        ))}
      </div>
      <HorizontalScrollIndicators targetId="vendor-category-tabs-rail" className="mb-2" />
    </div>
  );
}
