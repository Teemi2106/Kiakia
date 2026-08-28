// app/(customer)/home/_components/FilterChips.tsx
import { cn } from "@kiakia/ui";
import { Check, Clock3, Star, Zap } from "lucide-react";
import Link from "next/link";

export interface HomeSearchParams {
  q?: string;
  category?: string;
  open?: string;
  quick?: string;
  sort?: string;
}

interface ChipDef {
  key: "open" | "quick" | "sort";
  activeValue: string;
  label: string;
  icon: React.ReactNode;
}

const CHIPS: ChipDef[] = [
  { key: "open", activeValue: "1", label: "Open now", icon: <Zap className="size-3.5" /> },
  {
    key: "quick",
    activeValue: "1",
    // Deliberately "prep", not "delivery" — avg_prep_mins is kitchen time
    // only; KiaKia has no modeled end-to-end delivery ETA (that also
    // depends on rider travel time), so this chip must not imply one.
    label: "Quick prep",
    icon: <Clock3 className="size-3.5" />,
  },
  {
    key: "sort",
    activeValue: "rating",
    label: "Top rated",
    icon: <Star className="size-3.5" />,
  },
];

/**
 * Chowdeck's reference has "Discounts," "Pickup," and "Chowpass" chips too —
 * KiaKia has no promo-code system, no pickup order type (delivery only),
 * and no subscription tier, so those are omitted rather than shipped as
 * dead placeholders. "Delivery fee" is also skipped: KiaKia prices delivery
 * per-order from distance, not a static per-vendor fee, so there's nothing
 * to sort/filter a vendor list by without the customer's location.
 *
 * Every chip here toggles a real column: open -> is_accepting_orders +
 * opening_hours, quick -> avg_prep_mins, sort -> rating_avg/rating_count.
 */
export function FilterChips({ searchParams }: { searchParams: HomeSearchParams }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {CHIPS.map((chip) => {
        const isActive = searchParams[chip.key] === chip.activeValue;
        const params = new URLSearchParams();
        if (searchParams.q) params.set("q", searchParams.q);
        if (searchParams.category) params.set("category", searchParams.category);
        if (searchParams.open) params.set("open", searchParams.open);
        if (searchParams.quick) params.set("quick", searchParams.quick);
        if (searchParams.sort) params.set("sort", searchParams.sort);

        if (isActive) {
          params.delete(chip.key);
        } else {
          params.set(chip.key, chip.activeValue);
        }

        const href = params.size > 0 ? `/home?${params.toString()}` : "/home";

        return (
          <Link
            key={chip.key}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 font-inter text-xs font-semibold transition-all duration-200",
              isActive
                ? "border-kk-ink bg-kk-ink text-white"
                : "border-kk-line/70 bg-white/70 text-kk-cocoa hover:border-kk-ink/25 hover:text-kk-ink",
            )}
            aria-pressed={isActive}
          >
            {isActive ? <Check className="size-3.5" /> : chip.icon}
            {chip.label}
            {chip.key === "quick" && (
              <span className={cn("font-normal", isActive ? "text-white/60" : "text-kk-cocoa/55")}>
                under 30 min
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
