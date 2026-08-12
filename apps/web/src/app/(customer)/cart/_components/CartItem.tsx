// app/(auth)/customer/cart/_components/CartItem.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Minus, Plus } from "lucide-react";

interface CartItemProps {
  id: string;
  name: string;
  price: number;
  total: number;
  qty: number;
  image?: string | null;
  options?: string;
  pending: boolean;
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
  pending,
  onQtyChange,
  onRemove,
  variant = "mobile",
}: CartItemProps) {
  const isDesktop = variant === "desktop";

  return (
    <div
      className={`flex gap-4 ${isDesktop ? "" : "rounded-xl border border-[#E5E2E1] bg-white p-4 shadow-sm"}`}
    >
      {/* Image */}
      <div
        className={`shrink-0 overflow-hidden bg-[#E5E2E1] ${
          isDesktop
            ? "h-20 w-20 rounded-xl border border-[#E5E2E1]"
            : "h-20 w-20 rounded-lg"
        }`}
      >
        <div
          className="h-full w-full bg-cover bg-center"
          style={{
            backgroundImage: `url(${image || "/assets/food-placeholder.png"})`,
          }}
        />
      </div>

      {/* Details */}
      <div
        className={`flex flex-1 flex-col ${isDesktop ? "justify-between" : "justify-between"}`}
      >
        <div>
          <h3
            className={`font-inter ${isDesktop ? "text-[15px]" : "text-sm"} font-semibold text-[#1C1B1B]`}
          >
            {name}
          </h3>
          {options && (
            <p className="font-inter text-base text-[#5B403C]">{options}</p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="font-inter text-sm font-bold text-[#1C1B1B]">
            {formatNaira(koboOf(price))}
          </span>

          <div className="flex items-center gap-4">
            {isDesktop && (
              <button
                onClick={() => onRemove(id)}
                disabled={pending}
                className="font-inter text-xs font-medium text-[#906F6B] underline hover:text-[#5B403C] disabled:opacity-40"
              >
                Remove
              </button>
            )}

            <div
              className={`flex h-10 items-center gap-3 rounded-full bg-[#F6F3F2] px-2 ${
                isDesktop ? "h-[38px]" : "h-10"
              }`}
            >
              <button
                onClick={() => onQtyChange(id, qty - 1)}
                disabled={pending || qty <= 1}
                className={`flex items-center justify-center rounded-full hover:bg-black/5 disabled:opacity-40 ${
                  isDesktop ? "h-7 w-7" : "h-8 w-8"
                }`}
                aria-label="Decrease quantity"
              >
                <Minus
                  className={`${isDesktop ? "size-3.5" : "size-[8px]"} text-[#B61913]`}
                />
              </button>
              <span className="w-4 text-center font-inter text-sm font-semibold text-[#1C1B1B]">
                {qty}
              </span>
              <button
                onClick={() => onQtyChange(id, qty + 1)}
                disabled={pending}
                className={`flex items-center justify-center rounded-full bg-[#B61913] shadow-sm hover:bg-[#9e1611] disabled:opacity-40 ${
                  isDesktop
                    ? "h-7 w-7 border border-[#E5E2E1] bg-white hover:bg-gray-50"
                    : "h-8 w-8"
                }`}
                aria-label="Increase quantity"
              >
                <Plus
                  className={`${isDesktop ? "size-3.5 text-[#1C1B1B]" : "size-[8px] text-white"}`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
