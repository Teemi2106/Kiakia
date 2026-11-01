// app/(auth)/customer/cart/_components/CartItem.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Minus, Plus, UtensilsCrossed } from "lucide-react";
import Image from "next/image";

interface CartItemProps {
  id: string;
  name: string;
  price: number;
  total: number;
  qty: number;
  image?: string | null;
  options?: string;
  onQtyChange: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  variant?: "mobile" | "desktop";
}

export function CartItem({
  id,
  name,
  price,
  total,
  qty,
  image,
  options,
  onQtyChange,
  onRemove,
  variant = "mobile",
}: CartItemProps) {
  const isDesktop = variant === "desktop";

  return (
    <div
      className={`flex gap-4 ${isDesktop ? "" : "rounded-xl border border-kk-hair bg-kk-card p-4 shadow-sm"}`}
    >
      {/* Image — a UtensilsCrossed icon when there is none, same convention
          as MenuItemCard.tsx/ItemOptionsSheet.tsx use on the vendor page,
          rather than a placeholder image file (there has never been one at
          /assets/food-placeholder.png — that path 404s silently as a CSS
          background-image, which is why every cart line used to render as
          a plain grey box regardless of whether the dish actually had a
          photo). */}
      <div
        className={`relative shrink-0 overflow-hidden bg-kk-hair ${
          isDesktop
            ? "h-20 w-20 rounded-xl border border-kk-hair"
            : "h-20 w-20 rounded-lg"
        }`}
      >
        {image ? (
          <Image src={image} alt={name} fill sizes="80px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <UtensilsCrossed className="size-6 text-kk-cocoa/30" />
          </div>
        )}
      </div>

      {/* Details */}
      <div
        className={`flex flex-1 flex-col ${isDesktop ? "justify-between" : "justify-between"}`}
      >
        <div>
          <h3
            className={`font-inter ${isDesktop ? "text-[15px]" : "text-sm"} font-semibold text-kk-ink`}
          >
            {name}
          </h3>
          {options && (
            <p className="font-inter text-base text-kk-cocoa">{options}</p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="font-inter text-sm font-bold text-kk-ink">
            {formatNaira(koboOf(price))}
          </span>

          <div className="flex items-center gap-4">
            {isDesktop && (
              <button
                onClick={() => onRemove(id)}
                className="font-inter text-xs font-medium text-kk-taupe underline hover:text-kk-cocoa disabled:opacity-40"
              >
                Remove
              </button>
            )}

            <div
              className={`flex h-10 items-center gap-3 rounded-full bg-kk-sand px-2 ${
                isDesktop ? "h-[38px]" : "h-10"
              }`}
            >
              <button
                onClick={() => onQtyChange(id, qty - 1)}
                disabled={qty <= 1}
                className={`flex items-center justify-center rounded-full hover:bg-black/5 disabled:opacity-40 ${
                  isDesktop ? "h-7 w-7" : "h-8 w-8"
                }`}
                aria-label="Decrease quantity"
              >
                <Minus
                  className={`${isDesktop ? "size-3.5" : "size-[8px]"} text-kk-red-ink`}
                />
              </button>
              <span className="w-4 text-center font-inter text-sm font-semibold text-kk-ink">
                {qty}
              </span>
              <button
                onClick={() => onQtyChange(id, qty + 1)}
                className={`flex items-center justify-center rounded-full bg-kk-red shadow-sm hover:bg-kk-red-hover disabled:opacity-40 ${
                  isDesktop
                    ? "h-7 w-7 border border-kk-hair bg-kk-card hover:bg-gray-50"
                    : "h-8 w-8"
                }`}
                aria-label="Increase quantity"
              >
                <Plus
                  className={`${isDesktop ? "size-3.5 text-kk-ink" : "size-[8px] text-white"}`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
