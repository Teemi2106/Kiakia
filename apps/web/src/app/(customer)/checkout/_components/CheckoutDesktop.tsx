// app/(customer)/checkout/_components/CheckoutDesktop.tsx
"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { AddressSection } from "./AddressSection";
import { PaymentSection } from "./PaymentSection";
import { OrderSummary } from "./OrderSummary";
import type { Address, CartItem, Vendor, PaymentMethod } from "./types";

interface CheckoutDesktopProps {
  vendor: Vendor | null;
  items: CartItem[];
  addresses: Address[];
  selectedAddress: Address | null;
  onAddressChange: (address: Address) => void;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  subtotalKobo: number;
  deliveryNote: string;
  onDeliveryNoteChange: (note: string) => void;
}

export function CheckoutDesktop({
  vendor,
  items,
  addresses,
  selectedAddress,
  onAddressChange,
  paymentMethod,
  onPaymentMethodChange,
  subtotalKobo,
  deliveryNote,
  onDeliveryNoteChange,
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

      {/* 3-Column Grid */}
      <div className="grid grid-cols-3 gap-8">
        {/* Column 1: Address */}
        <AddressSection
          address={selectedAddress}
          addresses={addresses}
          onAddressChange={onAddressChange}
        />

        {/* Column 2: Payment */}
        <PaymentSection
          paymentMethod={paymentMethod}
          onPaymentMethodChange={onPaymentMethodChange}
        />

        {/* Column 3: Order Summary */}
        <OrderSummary
          vendor={vendor}
          items={items}
          subtotalKobo={subtotalKobo}
          deliveryNote={deliveryNote}
          onDeliveryNoteChange={onDeliveryNoteChange}
          paymentMethod={paymentMethod}
        />
      </div>
    </div>
  );
}
