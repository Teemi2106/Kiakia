// app/(customer)/checkout/_components/CheckoutMobile.tsx
"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { CheckoutFormState } from "@/app/actions/orders";
import { AddressSection } from "./AddressSection";
import { PaymentSection } from "./PaymentSection";
import { OrderSummary } from "./OrderSummary";
import type { Address, CartItem, Vendor, PaymentMethod } from "./types";

interface CheckoutMobileProps {
  vendor: Vendor | null;
  items: CartItem[];
  addresses: Address[];
  selectedAddress: Address | null;
  onAddressChange: (address: Address) => void;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  subtotalKobo: number;
  walletBalanceKobo: number;
  deliveryNote: string;
  onDeliveryNoteChange: (note: string) => void;
  formAction: (formData: FormData) => void;
  formState: CheckoutFormState;
  pending: boolean;
}

export function CheckoutMobile({
  vendor,
  items,
  addresses,
  selectedAddress,
  onAddressChange,
  paymentMethod,
  onPaymentMethodChange,
  subtotalKobo,
  walletBalanceKobo,
  deliveryNote,
  onDeliveryNoteChange,
  formAction,
  formState,
  pending,
}: CheckoutMobileProps) {
  return (
    <div className="flex min-h-screen flex-col pt-13 bg-[#FCF9F8]">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#FCF9F8] px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-4">
          <Link href="/cart" className="rounded-lg p-2 hover:bg-black/5">
            <ChevronLeft className="size-4 text-[#1C1B1B]" />
          </Link>
          <h1 className="font-sora text-2xl font-bold text-[#1C1B1B]">
            Checkout
          </h1>
        </div>
      </header>

      {/* Main Content — everything the place-order action reads (addressId,
          paymentMethod, deliveryNote) must be a descendant of this form. */}
      <form
        action={formAction}
        className="flex-1 space-y-6 px-4 pb-32 pt-6"
      >
        {selectedAddress && (
          <input type="hidden" name="addressId" value={selectedAddress.id} />
        )}
        <input type="hidden" name="paymentMethod" value={paymentMethod} />
        {/* Step 1: Delivery Address */}
        <div className="rounded-2xl border border-[#E5E2E1] bg-white p-4 shadow-sm">
          {/* No "Change" shortcut here — AddressSection already renders its
              own edit affordance once an address is selected, and adding a
              second control that does nothing (as this one previously did)
              would be misleading. */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(182,25,19,0.1)] text-sm font-semibold text-[#B61913]">
              1
            </div>
            <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
              Delivery Address
            </h2>
          </div>
          <AddressSection
            address={selectedAddress}
            addresses={addresses}
            onAddressChange={onAddressChange}
            vendorLocation={
              vendor?.location_lat != null && vendor?.location_lng != null
                ? { lat: vendor.location_lat, lng: vendor.location_lng }
                : null
            }
            variant="mobile"
          />
        </div>

        {/* Step 2: Payment Method */}
        <div className="rounded-2xl border border-[#E5E2E1] bg-white p-4 shadow-sm">
          {/* No "Change" shortcut — Card is the only supported method right
              now, so there's nothing to switch to yet (see PaymentSection). */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(182,25,19,0.1)] text-sm font-semibold text-[#B61913]">
              2
            </div>
            <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
              Payment Method
            </h2>
          </div>
          <PaymentSection
            paymentMethod={paymentMethod}
            onPaymentMethodChange={onPaymentMethodChange}
            walletBalanceKobo={walletBalanceKobo}
            subtotalKobo={subtotalKobo}
            variant="mobile"
          />
        </div>

        {/* Step 3: Order Review */}
        <div className="rounded-2xl border border-[#E5E2E1] bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(182,25,19,0.1)] text-sm font-semibold text-[#B61913]">
              3
            </div>
            <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
              Order Review
            </h2>
          </div>
          <OrderSummary
            vendor={vendor}
            items={items}
            subtotalKobo={subtotalKobo}
            deliveryNote={deliveryNote}
            onDeliveryNoteChange={onDeliveryNoteChange}
            paymentMethod={paymentMethod}
            formState={formState}
            pending={pending}
            variant="mobile"
          />
        </div>
      </form>
    </div>
  );
}
