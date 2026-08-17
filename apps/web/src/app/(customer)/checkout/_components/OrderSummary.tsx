// app/(customer)/checkout/_components/OrderSummary.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Button } from "@kiakia/ui";
import { ForkKnifeCrossedIcon } from "lucide-react";
import { placeOrderAction, type CheckoutFormState } from "@/app/actions/orders";
import { useActionState } from "react";
import Image from "next/image";
import type { CartItem, Vendor, PaymentMethod } from "./types";

const initialState = {};

interface OrderSummaryProps {
  vendor: Vendor | null;
  items: CartItem[];
  subtotalKobo: number;
  deliveryNote: string;
  onDeliveryNoteChange: (note: string) => void;
  paymentMethod: PaymentMethod;
  variant?: "desktop" | "mobile";
}

export function OrderSummary({
  vendor,
  items,
  subtotalKobo,
  deliveryNote,
  onDeliveryNoteChange,
  paymentMethod,
  variant = "desktop",
}: OrderSummaryProps) {
  const [state, formAction, pending] = useActionState<CheckoutFormState>(
    placeOrderAction as any,
    {} as CheckoutFormState,
  );
  const deliveryFeeKobo = 0; // This would be calculated based on location
  const totalKobo = subtotalKobo + deliveryFeeKobo;
  const isMobile = variant === "mobile";

  return (
    <form action={formAction} className="flex h-full flex-col">
      <div className="flex-1 space-y-6">
        {/* Heading */}
        <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
          Order Summary
        </h2>

        {/* Items List */}
        <div className="max-h-[300px] space-y-4 overflow-y-auto pr-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-4 border-b border-[rgba(228,190,184,0.5)] pb-4"
            >
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[#E5E2E1]">
                <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1] text-2xl text-[#5B403C]/20">
                  {vendor?.ProfileImage ? (
                    <Image src={vendor.ProfileImage || ""} alt={vendor.name} />
                  ) : (
                    <span className="text-6xl">
                      <ForkKnifeCrossedIcon />
                    </span>
                  )}
                </div>
              </div>
              <div className="flex-1">
                <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
                  {item.name_snapshot}
                </p>
                <p className="font-inter text-xs text-[#5B403C]">
                  Qty: {item.qty}
                </p>
              </div>
              <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
                {formatNaira(koboOf(item.line_total_kobo))}
              </span>
            </div>
          ))}
        </div>

        {/* Delivery Note */}
        <div>
          <label className="font-inter text-sm font-semibold text-[#1C1B1B]">
            Delivery note (optional)
          </label>
          <textarea
            value={deliveryNote}
            onChange={(e) => onDeliveryNoteChange(e.target.value)}
            rows={2}
            className="mt-2 w-full rounded-xl border border-[#E5E2E1] bg-[#F6F3F2] px-4 py-3 font-inter text-sm text-[#1C1B1B] placeholder:text-[#5B403C] focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
            placeholder="E.g. Gate code, landmark, call on arrival…"
          />
        </div>

        {/* Totals */}
        <div className="space-y-3 border-t border-[#E5E2E1] pt-4">
          <div className="flex justify-between">
            <span className="font-inter text-base text-[#5B403C]">
              Subtotal
            </span>
            <span className="font-inter text-base text-[#1C1B1B]">
              {formatNaira(koboOf(subtotalKobo))}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-inter text-base text-[#5B403C]">
              Delivery fee
            </span>
            <span className="font-inter text-base text-[#1C1B1B]">
              {formatNaira(koboOf(deliveryFeeKobo))}
            </span>
          </div>
          <div className="flex justify-between border-t border-[#E5E2E1] pt-4">
            <span className="font-sora text-2xl font-semibold text-[#1C1B1B]">
              Total
            </span>
            <span className="font-sora text-2xl font-semibold text-[#B61913]">
              {formatNaira(koboOf(totalKobo))}
            </span>
          </div>
        </div>

        {state.error && <p className="text-sm text-danger">{state.error}</p>}

        <input type="hidden" name="paymentMethod" value={paymentMethod} />
      </div>

      {/* Submit Button */}
      <Button
        type="submit"
        loading={pending}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#B61913] py-4 font-inter text-sm font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:bg-[#9e1611]"
      >
        Pay with {paymentMethod === "card" ? "Card" : "Cash on Delivery"} →
      </Button>

      {isMobile && (
        <p className="mt-3 text-center font-inter text-xs text-[#5B403C]">
          By placing your order, you agree to our Terms of Service
        </p>
      )}
    </form>
  );
}
