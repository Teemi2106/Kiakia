// app/(customer)/vendors/[slug]/_components/MenuItemCard.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Minus, Plus, UtensilsCrossed } from "lucide-react";
import Image from "next/image";
import { cn } from "@kiakia/ui";
import type { MenuItem } from "./types";

interface MenuItemCardProps {
  item: MenuItem;
  onAdd: (item: MenuItem) => void;
  onDecrement?: (item: MenuItem) => void;
  variant?: "desktop" | "mobile";
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
  qtyInCart = 0,
}: MenuItemCardProps) {
  const showStepper = qtyInCart > 0 && item.optionGroups.length === 0;
  const isDesktop = variant === "desktop";
  const isSoldOut = !item.isAvailable;

  return (
    <div
      className={cn(
        "group flex gap-4 rounded-2xl border border-kk-line bg-kk-card shadow-sm transition-shadow",
        isDesktop ? "p-4" : "p-3",
        isSoldOut ? "opacity-70" : "hover:shadow-md",
      )}
    >
      {/* Image */}
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-xl bg-kk-fill",
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
          <div className="flex h-full w-full items-center justify-center bg-kk-fill">
            <UtensilsCrossed className="size-8 text-kk-cocoa/30" />
          </div>
        )}
        {isSoldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="rounded-full bg-kk-card px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-kk-ink">
              Sold out
            </span>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex flex-1 flex-col justify-between">
        <div>
          <h3 className="font-inter text-sm font-semibold text-kk-ink sm:text-lg">
            {item.name}
          </h3>
          {item.description && (
            <p className="mt-1 line-clamp-2 text-sm text-kk-cocoa">
              {item.description}
            </p>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="font-inter text-sm font-bold text-kk-red-ink sm:text-base">
            {formatNaira(koboOf(item.priceKobo))}
          </span>

          {showStepper ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onDecrement?.(item)}
                aria-label={`Remove one ${item.name}`}
                className="flex size-8 items-center justify-center rounded-full border border-kk-line text-kk-ink transition-colors hover:bg-kk-fill disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Minus className="size-4" />
              </button>
              <span className="w-4 text-center text-sm font-bold text-kk-ink" aria-live="polite">
                {qtyInCart}
              </span>
              <button
                onClick={() => onAdd(item)}
                aria-label={`Add one more ${item.name}`}
                className="flex size-8 items-center justify-center rounded-full bg-kk-red text-white transition-colors hover:bg-kk-red-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => onAdd(item)}
              disabled={isSoldOut}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                isSoldOut
                  ? "cursor-not-allowed bg-kk-hair opacity-60"
                  : "bg-[rgba(218,53,41,0.1)] hover:bg-[rgba(218,53,41,0.2)]",
              )}
              aria-label={isSoldOut ? `${item.name} is sold out` : `Add ${item.name}`}
            >
              <Plus className="size-4 text-kk-red-ink" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
