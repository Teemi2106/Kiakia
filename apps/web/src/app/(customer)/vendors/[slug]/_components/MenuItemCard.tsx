// app/(customer)/vendors/[slug]/_components/MenuItemCard.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Loader2, Minus, Plus, UtensilsCrossed } from "lucide-react";
import Image from "next/image";
import { cn } from "@kiakia/ui";
import type { MenuItem } from "./types";

interface MenuItemCardProps {
  item: MenuItem;
  onAdd: (item: MenuItem) => void;
  onDecrement?: (item: MenuItem) => void;
  variant?: "desktop" | "mobile";
  isAdding?: boolean;
  /** Current quantity of this exact (no-option) item already in the open
   * cart — 0 shows the plain "+" button; >0 shows a real -/qty/+ stepper
   * instead, so repeated taps adjust one cart line rather than inserting a
   * new one each time. Always 0 for items with option groups (each add can
   * be a different combination, so there's no single line to step). */
  qtyInCart?: number;
}

export function MenuItemCard({
  item,
  onAdd,
  onDecrement,
  variant = "desktop",
  isAdding = false,
  qtyInCart = 0,
}: MenuItemCardProps) {
  const showStepper = qtyInCart > 0 && item.optionGroups.length === 0;
  const isDesktop = variant === "desktop";
  const isSoldOut = !item.isAvailable;

  return (
    <div
      className={cn(
        "group flex gap-4 rounded-2xl border border-[#E4BEB8] bg-white shadow-sm transition-shadow",
        isDesktop ? "p-4" : "p-3",
        isSoldOut ? "opacity-70" : "hover:shadow-md",
      )}
    >
      {/* Image */}
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-xl bg-[#F0EDED]",
          "h-[112px] w-[112px]",
        )}
      >
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            width={112}
            height={112}
            className={cn(
              "h-full w-full object-cover transition-transform",
              isSoldOut ? "grayscale" : "group-hover:scale-105",
            )}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#F0EDED]">
            <UtensilsCrossed className="size-8 text-[#5B403C]/30" />
          </div>
        )}
        {isSoldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#1C1B1B]">
              Sold out
            </span>
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

          {showStepper ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onDecrement?.(item)}
                disabled={isAdding}
                aria-label={`Remove one ${item.name}`}
                className="flex size-8 items-center justify-center rounded-full border border-[#E4BEB8] text-[#1C1B1B] transition-colors hover:bg-[#F0EDED] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Minus className="size-4" />
              </button>
              <span className="w-4 text-center text-sm font-bold text-[#1C1B1B]" aria-live="polite">
                {isAdding ? <Loader2 className="mx-auto size-3.5 animate-spin" /> : qtyInCart}
              </span>
              <button
                onClick={() => onAdd(item)}
                disabled={isAdding}
                aria-label={`Add one more ${item.name}`}
                className="flex size-8 items-center justify-center rounded-full bg-[#B61913] text-white transition-colors hover:bg-[#9e1611] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => onAdd(item)}
              disabled={isSoldOut || isAdding}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                isSoldOut || isAdding
                  ? "cursor-not-allowed bg-[#E5E2E1] opacity-60"
                  : "bg-[rgba(218,53,41,0.1)] hover:bg-[rgba(218,53,41,0.2)]",
              )}
              aria-label={isSoldOut ? `${item.name} is sold out` : `Add ${item.name}`}
            >
              {isAdding ? (
                <Loader2 className="size-4 animate-spin text-[#B61913]" />
              ) : (
                <Plus className="size-4 text-[#B61913]" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
