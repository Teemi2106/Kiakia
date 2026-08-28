// app/(customer)/home/_components/CategoryChips.tsx
import { cn } from "@kiakia/ui";
import type { MealCategoryPreset } from "@kiakia/domain";
import {
  Cookie,
  CupSoda,
  Flame,
  LayoutGrid,
  Package,
  Sandwich,
  Soup,
  Utensils,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

// Keyed by the same preset keys menu items are categorized under
// (packages/domain/src/meal-categories.ts's MEAL_CATEGORIES) — falls back to
// a generic fork/knife for anything not covered here.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  swallow: Wheat,
  soups: Soup,
  rice_dishes: Utensils,
  proteins_grills: Flame,
  small_chops_snacks: Sandwich,
  pastries_bakery: Cookie,
  drinks: CupSoda,
  combo_meals: Package,
};

interface CategoryChipsProps {
  categories: readonly MealCategoryPreset[];
  activeCategory?: string;
  preserveParams?: Record<string, string | undefined>;
}

function hrefFor(categoryKey: string | null, preserveParams?: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  if (preserveParams) {
    for (const [key, value] of Object.entries(preserveParams)) {
      if (value) params.set(key, value);
    }
  }
  if (categoryKey) params.set("category", categoryKey);
  const qs = params.toString();
  return qs ? `/home?${qs}` : "/home";
}

/**
 * One scroll rail at every breakpoint. This used to render two entirely
 * separate lists — icon tiles on mobile, text pills on desktop — which meant
 * the same control looked like two different features depending on the
 * window, and every change had to be made twice.
 */
export function CategoryChips({ categories, activeCategory, preserveParams }: CategoryChipsProps) {
  const items = [
    { key: null as string | null, label: "All" },
    ...categories.map((c) => ({ key: c.key as string | null, label: c.label })),
  ];

  return (
    <div className="relative">
      <div className="flex gap-2.5 overflow-x-auto pb-2 pr-10 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const isActive = item.key === (activeCategory ?? null);
          const Icon = item.key ? (CATEGORY_ICONS[item.key] ?? Utensils) : LayoutGrid;

          return (
            <Link
              key={item.label}
              href={hrefFor(item.key, preserveParams)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 rounded-full border pl-2.5 pr-4 font-inter text-sm font-semibold transition-all duration-200",
                isActive
                  ? "border-transparent bg-kk-red text-white shadow-[0_10px_22px_-12px_rgba(182,25,19,0.95)]"
                  : "border-kk-line/70 bg-white text-kk-cocoa hover:-translate-y-0.5 hover:border-kk-red/40 hover:text-kk-ink",
              )}
            >
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full transition-colors",
                  isActive ? "bg-white/20 text-white" : "bg-kk-sand text-kk-red",
                )}
              >
                <Icon className="size-4" />
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Fades the rail out at the right edge so it reads as scrollable. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-kk-cream to-transparent"
      />
    </div>
  );
}
