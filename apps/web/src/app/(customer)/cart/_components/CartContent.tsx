// app/(auth)/customer/cart/_components/CartContent.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Button } from "@kiakia/ui";
import { Minus, Plus, ChevronLeft, MapPin, Tag, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { removeCartItem, updateCartItemQty } from "@/lib/cart";

interface CartItemRow {
  readonly id: string;
  readonly name_snapshot: string;
  readonly unit_price_kobo: number;
  readonly qty: number;
  readonly line_total_kobo: number;
  readonly image_url?: string | null;
  readonly options?: string;
}

interface CartContentProps {
  items: readonly CartItemRow[];
  vendor: { id: string; name: string };
}

export function CartContent({ items, vendor }: CartContentProps) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const checkScreen = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    checkScreen();
    window.addEventListener("resize", checkScreen);
    return () => window.removeEventListener("resize", checkScreen);
  }, []);

  async function changeQty(id: string, qty: number) {
    if (qty < 0) return;
    setPendingId(id);
    await updateCartItemQty(id, qty);
    router.refresh();
    setPendingId(null);
  }

  async function removeAll() {
    // Clear all items logic
    for (const item of items) {
      await removeCartItem(item.id);
    }
    router.refresh();
  }

  async function remove(id: string) {
    setPendingId(id);
    await removeCartItem(id);
    router.refresh();
    setPendingId(null);
  }

  const totalKobo = items.reduce((sum, item) => sum + item.line_total_kobo, 0);
  const itemCount = items.reduce((sum, item) => sum + item.qty, 0);

  // Desktop: Render as drawer (same as before)
  if (isDesktop) {
    return (
      <>
        <div className="fixed inset-0 z-50 bg-black/50" />
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
              onClick={() => router.back()}
              className="rounded-full p-2 hover:bg-black/5"
              aria-label="Close cart"
            >
              <X className="size-4 text-[#5B403C]" />
            </button>
          </div>

          {/* Scrollable Items - Same as before */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="space-y-6">
              {items.map((item, index) => (
                <div key={item.id}>
                  <div className="flex gap-4">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-[#E5E2E1] bg-[#F0EDED]">
                      <div
                        className="h-full w-full bg-cover bg-center"
                        style={{
                          backgroundImage: `url(${item.image_url || "/assets/food-placeholder.png"})`,
                        }}
                      />
                    </div>
                    <div className="flex flex-1 flex-col justify-between">
                      <div className="flex items-start justify-between">
                        <span className="font-inter text-[15px] text-[#1C1B1B]">
                          {item.name_snapshot}
                        </span>
                        <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
                          {formatNaira(koboOf(item.line_total_kobo))}
                        </span>
                      </div>
                      <div className="flex items-end justify-between">
                        <button
                          onClick={() => remove(item.id)}
                          disabled={pendingId === item.id}
                          className="font-inter text-xs font-medium text-[#906F6B] underline hover:text-[#5B403C] disabled:opacity-40"
                        >
                          Remove
                        </button>
                        <div className="flex h-[38px] items-center gap-3 rounded-full border border-[#E5E2E1] bg-[#F6F3F2] px-1">
                          <button
                            onClick={() => changeQty(item.id, item.qty - 1)}
                            disabled={pendingId === item.id || item.qty <= 1}
                            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/5 disabled:opacity-40"
                          >
                            <Minus className="size-3.5 text-[#1C1B1B]" />
                          </button>
                          <span className="w-4 text-center font-inter text-sm font-semibold text-[#1C1B1B]">
                            {item.qty}
                          </span>
                          <button
                            onClick={() => changeQty(item.id, item.qty + 1)}
                            disabled={pendingId === item.id}
                            className="flex h-7 w-7 items-center justify-center rounded-full border border-[#E5E2E1] bg-white shadow-sm hover:bg-gray-50 disabled:opacity-40"
                          >
                            <Plus className="size-3.5 text-[#1C1B1B]" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  {index < items.length - 1 && (
                    <div className="my-6 h-px bg-[#EAE7E7]" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Sticky Footer - Same as before */}
          <div className="border-t border-[#EAE7E7] bg-white px-6 py-6 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.1)]">
            <div className="mb-6">
              <label className="mb-2 block font-inter text-xs font-medium text-[#5B403C]">
                Have a promo code?
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter code"
                  className="flex-1 rounded-xl border border-[#E5E2E1] bg-[#F6F3F2] px-4 py-3 font-inter text-base text-[#5B403C] placeholder:text-[#E4BEB8] focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
                />
                <button className="rounded-xl bg-[#E5E2E1] px-5 font-inter text-sm font-semibold text-[#5B403C] hover:bg-[#d5d2d2]">
                  Apply
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="font-inter text-base text-[#5B403C]">
                  Subtotal
                </span>
                <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
                  {formatNaira(koboOf(totalKobo))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-inter text-base text-[#5B403C]">
                  Delivery fee
                </span>
                <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
                  {formatNaira(koboOf(0))}
                </span>
              </div>
              <div className="h-px bg-[#EAE7E7]" />
              <div className="flex justify-between">
                <span className="font-sora text-xl font-bold text-[#1C1B1B]">
                  Total
                </span>
                <span className="font-sora text-2xl font-semibold text-[#B61913]">
                  {formatNaira(koboOf(totalKobo))}
                </span>
              </div>
            </div>
            <Link href="/checkout">
              <Button className="mt-4 w-full gap-2 rounded-xl bg-[#B61913] py-4 font-inter text-base font-normal text-white shadow-[0_4px_6px_-1px_rgba(182,25,19,0.2),0_2px_4px_-2px_rgba(182,25,19,0.2)] hover:bg-[#9e1611]">
                Proceed to Checkout →
              </Button>
            </Link>
          </div>
        </div>
      </>
    );
  }

  // ===== MOBILE VIEW =====
  return (
    <div className="flex min-h-screen flex-col bg-[#FCF9F8]">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#FCF9F8] px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.back()}
              className="rounded-full p-2 hover:bg-black/5"
              aria-label="Go back"
            >
              <ChevronLeft className="size-4 text-[#1C1B1B]" />
            </button>
            <h1 className="font-sora text-[28px] font-bold leading-[34px] text-[#1C1B1B]">
              Cart
            </h1>
          </div>
          <button
            onClick={removeAll}
            className="font-inter text-sm font-semibold text-[#B61913] hover:underline"
          >
            Clear
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 px-4 pb-32">
        <div className="space-y-6">
          {/* Delivery Info Banner */}
          <div className="flex items-start gap-4 rounded-xl bg-[#F6F3F2] p-4">
            <div className="rounded-full bg-[rgba(182,25,19,0.1)] p-2">
              <MapPin className="size-5 text-[#B61913]" />
            </div>
            <div>
              <h3 className="font-inter text-sm font-semibold text-[#1C1B1B]">
                Delivery Address
              </h3>
              <p className="font-inter text-base text-[#5B403C]">
                123 Main Street, Lagos
              </p>
            </div>
          </div>

          {/* Your Order Section */}
          <div>
            <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
              Your Order
            </h2>
          </div>

          {/* Cart Items */}
          <div className="space-y-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex gap-4 rounded-xl border border-[#E5E2E1] bg-white p-4 shadow-sm"
              >
                {/* Image */}
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-[#E5E2E1]">
                  <div
                    className="h-full w-full bg-cover bg-center"
                    style={{
                      backgroundImage: `url(${item.image_url || "/assets/food-placeholder.png"})`,
                    }}
                  />
                </div>

                {/* Details */}
                <div className="flex flex-1 flex-col justify-between">
                  <div>
                    <h3 className="font-inter text-sm font-semibold text-[#1C1B1B]">
                      {item.name_snapshot}
                    </h3>
                    {item.options && (
                      <p className="font-inter text-base text-[#5B403C]">
                        {item.options}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="font-inter text-sm font-bold text-[#1C1B1B]">
                      {formatNaira(koboOf(item.unit_price_kobo))}
                    </span>

                    {/* Quantity Controls */}
                    <div className="flex h-10 items-center gap-3 rounded-full bg-[#F6F3F2] px-2">
                      <button
                        onClick={() => changeQty(item.id, item.qty - 1)}
                        disabled={pendingId === item.id || item.qty <= 1}
                        className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/5 disabled:opacity-40"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="size-[8px] text-[#B61913]" />
                      </button>
                      <span className="w-4 text-center font-inter text-sm font-semibold text-[#1C1B1B]">
                        {item.qty}
                      </span>
                      <button
                        onClick={() => changeQty(item.id, item.qty + 1)}
                        disabled={pendingId === item.id}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-[#B61913] shadow-sm hover:bg-[#9e1611] disabled:opacity-40"
                        aria-label="Increase quantity"
                      >
                        <Plus className="size-[8px] text-white" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Promo Code */}
          <div className="relative">
            <div className="relative">
              <Tag className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#5B403C]" />
              <input
                type="text"
                placeholder="Add promo code"
                className="h-[49px] w-full rounded-xl border border-[#E5E2E1] bg-white pl-12 pr-24 font-inter text-base text-[#5B403C] placeholder:text-[#5B403C] focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
              />
              <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-[#EAE7E7] px-4 py-1.5 font-inter text-sm font-semibold text-[#1C1B1B] hover:bg-[#ddd9d9]">
                Apply
              </button>
            </div>
          </div>

          {/* Order Summary */}
          <div className="rounded-xl border border-[#E5E2E1] bg-white p-4 shadow-sm">
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="font-inter text-base text-[#5B403C]">
                  Subtotal
                </span>
                <span className="font-inter text-base font-semibold text-[#1C1B1B]">
                  {formatNaira(koboOf(totalKobo))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-inter text-base text-[#5B403C]">
                  Delivery fee
                </span>
                <span className="font-inter text-base font-semibold text-[#1C1B1B]">
                  {formatNaira(koboOf(0))}
                </span>
              </div>
              <div className="h-px bg-[#E5E2E1]" />
              <div className="flex justify-between pt-2">
                <span className="font-sora text-2xl font-bold text-[#1C1B1B]">
                  Total
                </span>
                <span className="font-sora text-2xl font-bold text-[#B61913]">
                  {formatNaira(koboOf(totalKobo))}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-[#E5E2E1] bg-[#FCF9F8] px-4 py-4 shadow-[0_-4px_12px_rgba(26,26,26,0.05)]">
        <Link href="/checkout">
          <button className="flex h-16 w-full items-center justify-center gap-2 rounded-xl bg-[#B61913] font-sora text-2xl font-bold text-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)] hover:bg-[#9e1611]">
            Checkout
            <span className="text-white">→</span>
          </button>
        </Link>
      </div>
    </div>
  );
}
