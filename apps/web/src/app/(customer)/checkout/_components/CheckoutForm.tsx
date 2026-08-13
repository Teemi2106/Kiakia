// app/(customer)/checkout/_components/CheckoutForm.tsx
"use client";

import { useState } from "react";
import { CheckoutDesktop } from "./CheckoutDesktop";
import { CheckoutMobile } from "./CheckoutMobile";
import type { Address, CartItem, Vendor, PaymentMethod } from "./types";

interface CheckoutFormProps {
  vendor: Vendor | null;
  items: CartItem[];
  addresses: Address[];
  defaultAddress: Address | null;
  subtotalKobo: number;
}

export function CheckoutForm({
  vendor,
  items,
  addresses,
  defaultAddress,
  subtotalKobo,
}: CheckoutFormProps) {
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(
    defaultAddress,
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [deliveryNote, setDeliveryNote] = useState("");

  // If no address is selected, use the first available
  const activeAddress = selectedAddress || addresses[0] || null;

  return (
    <>
      <div className="hidden lg:block">
        <CheckoutDesktop
          vendor={vendor}
          items={items}
          addresses={addresses}
          selectedAddress={activeAddress}
          onAddressChange={setSelectedAddress}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          subtotalKobo={subtotalKobo}
          deliveryNote={deliveryNote}
          onDeliveryNoteChange={setDeliveryNote}
        />
      </div>
      <div className="lg:hidden">
        <CheckoutMobile
          vendor={vendor}
          items={items}
          addresses={addresses}
          selectedAddress={activeAddress}
          onAddressChange={setSelectedAddress}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          subtotalKobo={subtotalKobo}
          deliveryNote={deliveryNote}
          onDeliveryNoteChange={setDeliveryNote}
        />
      </div>
    </>
  );
}
