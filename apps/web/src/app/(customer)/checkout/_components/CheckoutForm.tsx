// app/(customer)/checkout/_components/CheckoutForm.tsx
"use client";

import { useActionState, useState } from "react";
import { placeOrderAction, type CheckoutFormState } from "@/app/actions/orders";
import { CheckoutDesktop } from "./CheckoutDesktop";
import { CheckoutMobile } from "./CheckoutMobile";
import type { Address, CartItem, Vendor, PaymentMethod } from "./types";

interface CheckoutFormProps {
  vendor: Vendor | null;
  items: CartItem[];
  addresses: Address[];
  defaultAddress: Address | null;
  subtotalKobo: number;
  walletBalanceKobo: number;
}

const initialState: CheckoutFormState = {};

export function CheckoutForm({
  vendor,
  items,
  addresses,
  defaultAddress,
  subtotalKobo,
  walletBalanceKobo,
}: CheckoutFormProps) {
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(
    defaultAddress,
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [formState, formAction, pending] = useActionState(
    placeOrderAction,
    initialState,
  );

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
          walletBalanceKobo={walletBalanceKobo}
          deliveryNote={deliveryNote}
          onDeliveryNoteChange={setDeliveryNote}
          formAction={formAction}
          formState={formState}
          pending={pending}
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
          walletBalanceKobo={walletBalanceKobo}
          deliveryNote={deliveryNote}
          onDeliveryNoteChange={setDeliveryNote}
          formAction={formAction}
          formState={formState}
          pending={pending}
        />
      </div>
    </>
  );
}
