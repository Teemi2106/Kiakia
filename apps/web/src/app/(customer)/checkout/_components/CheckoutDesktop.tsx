// app/(customer)/checkout/_components/CheckoutDesktop.tsx
"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { CheckoutFormState } from "@/app/actions/orders";
import { AddressSection } from "./AddressSection";
import { PaymentSection } from "./PaymentSection";
import { OrderSummary } from "./OrderSummary";
import type { Address, CartItem, Vendor, PaymentMethod } from "./types";
import type { DeliveryFeeEstimate } from "@/lib/checkout/useDeliveryFeeEstimate";

interface CheckoutDesktopProps {
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

export function CheckoutDesktop({
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
}: CheckoutDesktopProps) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Back Link */}
      <Link
        href="/cart"
        className="mb-6 inline-flex items-center gap-2 font-inter text-sm font-semibold text-[#5B403C] hover:text-[#1C1B1B]"
      >
        <ChevronLeft className="size-4" />
        Back to Cart
      </Link>

      <h1 className="mb-8 font-sora text-[32px] font-bold leading-10 tracking-[-0.32px] text-[#1C1B1B]">
        Checkout
      </h1>

      {/* All controls below must live inside this form: placeOrderAction
          reads addressId, paymentMethod and deliveryNote from its FormData,
          so AddressSection/PaymentSection/OrderSummary can no longer be
          form-adjacent siblings. */}
      <form action={formAction} className="grid grid-cols-3 gap-8">
        {selectedAddress && (
          <input type="hidden" name="addressId" value={selectedAddress.id} />
        )}
        <input type="hidden" name="paymentMethod" value={paymentMethod} />
        <input type="hidden" name="useWallet" value={paymentMethod === "card" && useWallet ? "1" : "0"} />

        {/* Column 1: Address */}
        <AddressSection
          address={selectedAddress}
          addresses={addresses}
          onAddressChange={onAddressChange}
          vendorLocation={
            vendor?.location_lat != null && vendor?.location_lng != null
              ? { lat: vendor.location_lat, lng: vendor.location_lng }
              : null
          }
        />

        {/* Column 2: Payment */}
        <PaymentSection
          paymentMethod={paymentMethod}
          onPaymentMethodChange={onPaymentMethodChange}
          useWallet={useWallet}
          onUseWalletChange={onUseWalletChange}
          walletBalanceKobo={walletBalanceKobo}
          subtotalKobo={subtotalKobo}
        />

        {/* Column 3: Order Summary */}
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
        />
      </form>
    </div>
  );
}
