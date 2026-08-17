// app/(customer)/vendors/[slug]/_components/MenuItemCard.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Plus } from "lucide-react";
import Image from "next/image";
import { cn } from "@kiakia/ui";
import type { MenuItem } from "./types";

interface MenuItemCardProps {
  item: MenuItem;
  onAdd: (item: MenuItem) => void;
  variant?: "desktop" | "mobile";
}

export function MenuItemCard({
  item,
  onAdd,
  variant = "desktop",
}: MenuItemCardProps) {
  const isDesktop = variant === "desktop";

  return (
    <div
      className={cn(
        "flex gap-4 rounded-xl border border-[#E4BEB8] bg-white",
        isDesktop ? "p-4" : "p-3",
      )}
    >
      {/* Image */}
      <div
        className={cn(
          "shrink-0 overflow-hidden bg-[#F0EDED]",
          isDesktop
            ? "h-[112px] w-[112px] rounded-xl"
            : "h-[112px] w-[112px] rounded-lg",
        )}
      >
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            width={112}
            height={112}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#F0EDED]">
            <span className="text-4xl text-[#5B403C]/20">🍽️</span>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex flex-1 flex-col justify-between">
        <div>
          <h3 className="font-inter text-sm font-semibold text-[#1C1B1B] sm:text-lg">
            {item.name}
          </h3>
          {item.description && (
            <p className="mt-1 line-clamp-2 text-sm text-[#5B403C]">
              {item.description}
            </p>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="font-inter text-sm font-bold text-[#B61913] sm:text-base">
            {formatNaira(koboOf(item.priceKobo))}
          </span>

          <button
            onClick={() => onAdd(item)}
            disabled={!item.isAvailable}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              item.isAvailable
                ? "bg-[rgba(218,53,41,0.1)] hover:bg-[rgba(218,53,41,0.2)]"
                : "cursor-not-allowed bg-[#E5E2E1] opacity-50",
            )}
            aria-label={`Add ${item.name}`}
          >
            <Plus className="size-4 text-[#B61913]" />
          </button>
        </div>
      </div>
    </div>
  );
}
