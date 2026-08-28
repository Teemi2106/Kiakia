// app/(customer)/cart/_components/CartMobile.tsx
"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { formatCartItemOptions, type CartLineItem } from "@/lib/cart";
import { CartItem } from "./CartItem";
import { PromoCode } from "./PromoCode";
import { OrderSummary } from "./OrderSummary";
import { DeliveryInfo } from "./DeliveryInfo";

interface CartMobileProps {
  items: CartLineItem[];
  vendor: { id: string; name: string };
  onClose: () => void;
  pendingId: string | null;
  onQtyChange: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
}

export function CartMobile({
  items,
  // kept in the prop contract for parity with CartDesktop/future vendor-name display, not currently rendered
  vendor: _vendor,
  onClose,
  pendingId,
  onQtyChange,
  onRemove,
  onClearAll,
}: CartMobileProps) {
  const totalKobo = items.reduce((sum, item) => sum + item.line_total_kobo, 0);

  return (
    <>
      {/* Overlay - dims the background */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Full-screen cart panel */}
      <div className="fixed inset-0 z-50 flex flex-col bg-[#FCF9F8] animate-slide-up">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-[#FCF9F8] px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="rounded-full p-2 hover:bg-black/5"
                aria-label="Close cart"
              >
                <ChevronLeft className="size-4 text-[#1C1B1B]" />
              </button>
              <h1 className="font-sora text-[28px] font-bold leading-[34px] text-[#1C1B1B]">
                Cart
              </h1>
            </div>
            <button
              onClick={onClearAll}
              className="font-inter text-sm font-semibold text-[#B61913] hover:underline"
            >
              Clear
            </button>
          </div>
        </header>

        {/* Main Content - Scrollable */}
        <div className="flex-1 overflow-y-auto px-4 pb-32">
          <div className="space-y-6">
            <DeliveryInfo />

            <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
              Your Order
            </h2>

            <div className="space-y-4">
              {items.map((item) => (
                <CartItem
                  key={item.id}
                  id={item.id}
                  name={item.name_snapshot}
                  price={item.unit_price_kobo}
                  total={item.line_total_kobo}
                  qty={item.qty}
                  options={formatCartItemOptions(item.options_snapshot)}
                  pending={pendingId === item.id}
                  onQtyChange={onQtyChange}
                  onRemove={onRemove}
                  variant="mobile"
                />
              ))}
            </div>

            <PromoCode />
            <OrderSummary total={totalKobo} />
          </div>
        </div>

        {/* Sticky Bottom CTA */}
        <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-[#E5E2E1] bg-[#FCF9F8] px-4 py-4 shadow-[0_-4px_12px_rgba(26,26,26,0.05)]">
          <Link href="/checkout" onClick={onClose}>
            <button className="flex h-16 w-full items-center justify-center gap-2 rounded-xl bg-[#B61913] font-sora text-2xl font-bold text-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)] hover:bg-[#9e1611]">
              Checkout
              <span className="text-white">→</span>
            </button>
          </Link>
        </div>
      </div>
    </>
  );
}
