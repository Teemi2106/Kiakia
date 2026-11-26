// app/(customer)/checkout/_components/OrderSummary.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Button } from "@kiakia/ui";
import { ForkKnifeCrossedIcon } from "lucide-react";
import type { CheckoutFormState } from "@/app/actions/orders";
import type { DeliveryFeeEstimate } from "@/lib/checkout/useDeliveryFeeEstimate";
import Image from "next/image";
import type { CartItem, Vendor, PaymentMethod } from "./types";

interface OrderSummaryProps {
  vendor: Vendor | null;
  items: CartItem[];
  subtotalKobo: number;
  /** Server-computed from the live admin-set rate; null when it could not be read. */
  serviceFeeKobo: number | null;
  deliveryFeeEstimate: DeliveryFeeEstimate;
  deliveryNote: string;
  onDeliveryNoteChange: (note: string) => void;
  // Kept in the prop shape for when a second payment method actually ships
  // (see PaymentSection); the submit button below no longer branches on it
  // since Card is the only method placeOrderAction supports today.
  paymentMethod: PaymentMethod;
  formState: CheckoutFormState;
  pending: boolean;
  variant?: "desktop" | "mobile";
}

export function OrderSummary({
  vendor,
  items,
  subtotalKobo,
  serviceFeeKobo,
  deliveryFeeEstimate,
  deliveryNote,
  onDeliveryNoteChange,
  paymentMethod: _paymentMethod,
  formState,
  pending,
  variant = "desktop",
}: OrderSummaryProps) {
  // Never fabricated: while the real fee is still resolving, or the address
  // falls outside every service area, this shows a real absence rather than
  // a wrong number that happens to look like one — see
  // useDeliveryFeeEstimate.ts. place_order() computes the authoritative
  // total server-side regardless of what displays here.
  const deliveryFeeKobo = deliveryFeeEstimate.feeKobo ?? 0;
  const totalKobo = subtotalKobo + deliveryFeeKobo + (serviceFeeKobo ?? 0);
  const isMobile = variant === "mobile";

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-6">
        {/* Heading */}
        <h2 className="font-sora text-2xl font-semibold text-kk-ink">
          Order Summary
        </h2>

        {/* Items List */}
        <div className="max-h-[300px] space-y-4 overflow-y-auto pr-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-4 border-b border-[rgba(228,190,184,0.5)] pb-4"
            >
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-kk-hair">
                <div className="flex h-full w-full items-center justify-center bg-kk-hair text-2xl text-kk-cocoa/20">
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
                <p className="font-inter text-sm font-semibold text-kk-ink">
                  {item.name_snapshot}
                </p>
                <p className="font-inter text-xs text-kk-cocoa">
                  Qty: {item.qty}
                </p>
              </div>
              <span className="font-inter text-sm font-semibold text-kk-ink">
                {formatNaira(koboOf(item.line_total_kobo))}
              </span>
            </div>
          ))}
        </div>

        {/* Delivery Note */}
        <div>
          <label className="font-inter text-sm font-semibold text-kk-ink">
            Delivery note (optional)
          </label>
          <textarea
            name="deliveryNote"
            value={deliveryNote}
            onChange={(e) => onDeliveryNoteChange(e.target.value)}
            rows={2}
            className="mt-2 w-full rounded-xl border border-kk-hair bg-kk-sand px-4 py-3 font-inter text-sm text-kk-ink placeholder:text-kk-cocoa focus:border-kk-red focus:outline-none focus:ring-2 focus:ring-kk-red/20"
            placeholder="E.g. Gate code, landmark, call on arrival…"
          />
        </div>

        {/* Totals */}
        <div className="space-y-3 border-t border-kk-hair pt-4">
          <div className="flex justify-between">
            <span className="font-inter text-base text-kk-cocoa">
              Subtotal
            </span>
            <span className="font-inter text-base text-kk-ink">
              {formatNaira(koboOf(subtotalKobo))}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-inter text-base text-kk-cocoa">
              Delivery fee
            </span>
            <span className="font-inter text-base text-kk-ink">
              {deliveryFeeEstimate.loading ? (
                "Calculating…"
              ) : deliveryFeeEstimate.outsideServiceArea ? (
                "Unavailable here"
              ) : (
                formatNaira(koboOf(deliveryFeeKobo))
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-inter text-base text-kk-cocoa">
              Service fee
            </span>
            <span className="font-inter text-base text-kk-ink">
              {serviceFeeKobo === null ? "Added at payment" : formatNaira(koboOf(serviceFeeKobo))}
            </span>
          </div>
          <div className="flex justify-between border-t border-kk-hair pt-4">
            <span className="font-sora text-2xl font-semibold text-kk-ink">
              Total
            </span>
            <span className="font-sora text-2xl font-semibold text-kk-red-ink">
              {formatNaira(koboOf(totalKobo))}
            </span>
          </div>
        </div>

        {formState.error && (
          <p className="text-sm text-danger">{formState.error}</p>
        )}
      </div>

      {/* Submit Button */}
      <Button
        type="submit"
        loading={pending}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-kk-red py-4 font-inter text-sm font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:bg-kk-red-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        Pay with Card →
      </Button>

      {isMobile && (
        <p className="mt-3 text-center font-inter text-xs text-kk-cocoa">
          By placing your order, you agree to our Terms of Service
        </p>
      )}
    </div>
  );
}
