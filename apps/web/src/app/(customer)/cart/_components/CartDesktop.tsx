// components/Cart/CartDesktop.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Button } from "@kiakia/ui";
import { X } from "lucide-react";
import Link from "next/link";
import { formatCartItemOptions, type CartLineItem } from "@/lib/cart";
import { CartItem } from "./CartItem";
import { PromoCode } from "./PromoCode";
import { OrderSummary } from "./OrderSummary";

interface CartDesktopProps {
  items: CartLineItem[];
  vendor: { id: string; name: string };
  onClose: () => void;
  pendingId: string | null;
  onQtyChange: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
}

export function CartDesktop({
  items,
  // kept in the prop contract for parity with CartMobile/future vendor-name display, not currently rendered
  vendor: _vendor,
  onClose,
  pendingId,
  onQtyChange,
  onRemove,
}: CartDesktopProps) {
  const totalKobo = items.reduce((sum, item) => sum + item.line_total_kobo, 0);
  const itemCount = items.reduce((sum, item) => sum + item.qty, 0);

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-[420px] flex-col bg-white shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#EAE7E7] px-6 py-5">
          <div>
            <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
              Your Cart
            </h2>
            <div className="flex items-center gap-1 text-sm text-[#5B403C]">
              <span>•</span>
              <span>
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 hover:bg-black/5"
            aria-label="Close cart"
          >
            <X className="size-4 text-[#5B403C]" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-6">
            {items.map((item, index) => (
              <div key={item.id}>
                <CartItem
                  id={item.id}
                  name={item.name_snapshot}
                  price={item.unit_price_kobo}
                  total={item.line_total_kobo}
                  qty={item.qty}
                  options={formatCartItemOptions(item.options_snapshot)}
                  pending={pendingId === item.id}
                  onQtyChange={onQtyChange}
                  onRemove={onRemove}
                  variant="desktop"
                />
                {index < items.length - 1 && (
                  <div className="my-6 h-px bg-[#EAE7E7]" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#EAE7E7] bg-white px-6 py-6 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.1)]">
          <PromoCode />
          <OrderSummary total={totalKobo} />
          <Link href="/checkout" onClick={onClose}>
            <Button className="mt-4 w-full gap-2 rounded-xl bg-[#B61913] py-4 font-inter text-base font-normal text-white shadow-[0_4px_6px_-1px_rgba(182,25,19,0.2),0_2px_4px_-2px_rgba(182,25,19,0.2)] hover:bg-[#9e1611]">
              Proceed to Checkout →
            </Button>
          </Link>
        </div>
      </div>
    </>
  );
}
