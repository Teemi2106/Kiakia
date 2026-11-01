// app/(customer)/checkout/_components/CheckoutMobile.tsx
"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { CheckoutFormState } from "@/app/actions/orders";
import { AddressSection } from "./AddressSection";
import { PaymentSection } from "./PaymentSection";
import { OrderSummary } from "./OrderSummary";
import type { Address, CartItem, Vendor, PaymentMethod } from "./types";
import type { DeliveryFeeEstimate } from "@/lib/checkout/useDeliveryFeeEstimate";

interface CheckoutMobileProps {
  vendor: Vendor | null;
  items: CartItem[];
  addresses: Address[];
  selectedAddress: Address | null;
  onAddressChange: (address: Address) => void;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  useWallet: boolean;
  onUseWalletChange: (useWallet: boolean) => void;
  subtotalKobo: number;
  serviceFeeKobo: number | null;
  walletBalanceKobo: number;
  deliveryFeeEstimate: DeliveryFeeEstimate;
  deliveryNote: string;
  onDeliveryNoteChange: (note: string) => void;
  customerPhone: string | null;
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
  useWallet,
  onUseWalletChange,
  subtotalKobo,
  serviceFeeKobo,
  walletBalanceKobo,
  deliveryFeeEstimate,
  deliveryNote,
  onDeliveryNoteChange,
  customerPhone,
  formAction,
  formState,
  pending,
}: CheckoutMobileProps) {
  return (
    <div className="flex min-h-screen flex-col pt-13 bg-kk-cream">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-kk-cream px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-4">
          <Link href="/cart" className="rounded-lg p-2 hover:bg-black/5">
            <ChevronLeft className="size-4 text-kk-ink" />
          </Link>
          <h1 className="font-sora text-2xl font-bold text-kk-ink">
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
        <input type="hidden" name="useWallet" value={paymentMethod === "card" && useWallet ? "1" : "0"} />
        {/* Step 1: Delivery Address */}
        <div className="rounded-2xl border border-kk-hair bg-kk-card p-4 shadow-sm">
          {/* No "Change" shortcut here — AddressSection already renders its
              own edit affordance once an address is selected, and adding a
              second control that does nothing (as this one previously did)
              would be misleading. */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-kk-red/10 text-sm font-semibold text-kk-red-ink">
              1
            </div>
            <h2 className="font-sora text-2xl font-semibold text-kk-ink">
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
        <div className="rounded-2xl border border-kk-hair bg-kk-card p-4 shadow-sm">
          {/* No "Change" shortcut — Card is the only supported method right
              now, so there's nothing to switch to yet (see PaymentSection). */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-kk-red/10 text-sm font-semibold text-kk-red-ink">
              2
            </div>
            <h2 className="font-sora text-2xl font-semibold text-kk-ink">
              Payment Method
            </h2>
          </div>
          <PaymentSection
            paymentMethod={paymentMethod}
            onPaymentMethodChange={onPaymentMethodChange}
            useWallet={useWallet}
            onUseWalletChange={onUseWalletChange}
            walletBalanceKobo={walletBalanceKobo}
            subtotalKobo={subtotalKobo}
            variant="mobile"
          />
        </div>

        {/* Step 3: Order Review */}
        <div className="rounded-2xl border border-kk-hair bg-kk-card p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-kk-red/10 text-sm font-semibold text-kk-red-ink">
              3
            </div>
            <h2 className="font-sora text-2xl font-semibold text-kk-ink">
              Order Review
            </h2>
          </div>
          <OrderSummary
            vendor={vendor}
            items={items}
            subtotalKobo={subtotalKobo}
            serviceFeeKobo={serviceFeeKobo}
            deliveryFeeEstimate={deliveryFeeEstimate}
            deliveryNote={deliveryNote}
            onDeliveryNoteChange={onDeliveryNoteChange}
            customerPhone={customerPhone}
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
