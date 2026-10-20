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
  /** profiles.phone as of page load — prefills the field below so a
   * returning customer isn't retyping it. placeOrderAction writes whatever
   * is submitted here back to profiles.phone, so this only ever needs
   * asking once in practice. */
  customerPhone: string | null;
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
  customerPhone,
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

        {/* Contact Phone — required so the rider can actually reach the
            customer (get_rider_offer_details(), extended by 0072, reads
            this straight off profiles.phone). Uncontrolled: unlike
            deliveryNote, nothing else on this page needs its live value,
            so a plain defaultValue read via FormData is enough. */}
        <div>
          <label htmlFor="contactPhone" className="font-inter text-sm font-semibold text-[#1C1B1B]">
            Contact phone
          </label>
          <input
            id="contactPhone"
            name="contactPhone"
            type="tel"
            required
            defaultValue={customerPhone ?? ""}
            placeholder="0801 234 5678"
            className="mt-2 w-full rounded-xl border border-[#E5E2E1] bg-[#F6F3F2] px-4 py-3 font-inter text-sm text-[#1C1B1B] placeholder:text-[#5B403C] focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
          />
          <p className="mt-1.5 font-inter text-xs text-[#5B403C]">
            Your rider will use this number if they need to reach you.
          </p>
        </div>

        {/* Delivery Note */}
        <div>
          <label className="font-inter text-sm font-semibold text-[#1C1B1B]">
            Delivery note (optional)
          </label>
          <textarea
            name="deliveryNote"
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
            <span className="font-inter text-base text-[#5B403C]">
              Service fee
            </span>
            <span className="font-inter text-base text-[#1C1B1B]">
              {serviceFeeKobo === null ? "Added at payment" : formatNaira(koboOf(serviceFeeKobo))}
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

        {formState.error && (
          <p className="text-sm text-danger">{formState.error}</p>
        )}
      </div>

      {/* Submit Button */}
      <Button
        type="submit"
        loading={pending}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#B61913] py-4 font-inter text-sm font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:bg-[#9e1611] disabled:cursor-not-allowed disabled:opacity-60"
      >
        Pay with Card →
      </Button>

      {isMobile && (
        <p className="mt-3 text-center font-inter text-xs text-[#5B403C]">
          By placing your order, you agree to our Terms of Service
        </p>
      )}
    </div>
  );
}
