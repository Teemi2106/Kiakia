// app/(customer)/home/_components/FeaturedCarousel.tsx
"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FeaturedItemCard } from "./FeaturedItemCard";
import type { VendorCardVendor } from "./VendorCard";

export interface FeaturedVendor {
  vendor: VendorCardVendor;
  /** The dish's own name — this is the headline on the card (see
   * FeaturedItemCard), not the vendor's name. */
  dishName: string;
  /** A real photo from one of this vendor's own menu items — chosen
   * because a specific appetizing dish sells a vendor better than its
   * generic storefront banner, same reasoning food-delivery apps usually
   * use for a "Featured" strip. Never a stock/placeholder image standing
   * in for a dish that doesn't exist. */
  dishImageUrl: string;
}

/**
 * Horizontally-scrolling row (not a grid) — the one place on this page
 * that intentionally breaks from the grid layout, since a "Featured" strip
 * reads as curated/appetizing specifically because you scroll it, not
 * because it's arranged differently from a real algorithmic ranking (that
 * honesty concern is why "Top rated"/"All vendors" below stay plain grids).
 */
export function FeaturedCarousel({ items }: { items: readonly FeaturedVendor[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  function scrollByAmount(direction: 1 | -1) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // Page by whatever is actually on screen rather than a hard-coded card
    // width, so the arrows still land on a card boundary at any breakpoint.
    scroller.scrollBy({ left: direction * scroller.clientWidth * 0.8, behavior: "smooth" });
  }

  if (items.length === 0) return null;

  return (
    <div className="group/carousel relative">
      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map(({ vendor, dishName, dishImageUrl }) => (
          <FeaturedItemCard
            key={`${vendor.id}-${dishName}`}
            vendor={vendor}
            dishName={dishName}
            dishImageUrl={dishImageUrl}
            className="w-[188px] shrink-0 snap-start sm:w-[232px]"
          />
        ))}
      </div>

      {items.length > 2 && (
        <>
          <CarouselButton direction={-1} onClick={() => scrollByAmount(-1)} />
          <CarouselButton direction={1} onClick={() => scrollByAmount(1)} />
        </>
      )}
    </div>
  );
}

function CarouselButton({ direction, onClick }: { direction: 1 | -1; onClick: () => void }) {
  const isNext = direction === 1;
  const Icon = isNext ? ChevronRight : ChevronLeft;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isNext ? "Scroll featured right" : "Scroll featured left"}
      className={`absolute top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-kk-line/70 bg-white/95 shadow-[0_10px_24px_-10px_rgba(28,27,27,0.45)] backdrop-blur transition-all duration-300 hover:border-kk-red/40 hover:text-kk-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kk-red/45 sm:flex sm:opacity-0 sm:group-hover/carousel:opacity-100 sm:focus-visible:opacity-100 ${
        isNext ? "-right-3" : "-left-3"
      }`}
    >
      <Icon className="size-5 text-kk-ink" />
    </button>
  );
}
