// app/(customer)/checkout/_components/CheckoutForm.tsx
"use client";

import { useActionState, useState } from "react";
import { placeOrderAction, type CheckoutFormState } from "@/app/actions/orders";
import { useDeliveryFeeEstimate } from "@/lib/checkout/useDeliveryFeeEstimate";
import { CheckoutDesktop } from "./CheckoutDesktop";
import { CheckoutMobile } from "./CheckoutMobile";
import type { Address, CartItem, Vendor, PaymentMethod } from "./types";

interface CheckoutFormProps {
  vendor: Vendor | null;
  items: CartItem[];
  addresses: Address[];
  defaultAddress: Address | null;
  subtotalKobo: number;
  /** Live service fee for this subtotal, computed server-side from the admin-set rate; null if it could not be read. */
  serviceFeeKobo: number | null;
  walletBalanceKobo: number;
  /** profiles.phone as of page load — prefills the required contact-phone
   * field so a returning customer isn't retyping it every order. */
  customerPhone: string | null;
}

const initialState: CheckoutFormState = {};

export function CheckoutForm({
  vendor,
  items,
  addresses,
  defaultAddress,
  subtotalKobo,
  serviceFeeKobo,
  walletBalanceKobo,
  customerPhone,
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

  // No manual useMemo here — the React Compiler auto-memoizes these (see
  // AGENTS.md: this Next.js version's conventions differ from pre-compiler
  // React), and a hand-written dependency array listing only the two
  // numeric fields is exactly what the compiler flags as unpreservable
  // manual memoization. Whether or not the compiler actually holds this
  // object reference stable across every render doesn't matter to
  // useDeliveryFeeEstimate() any more, though — it keys its own effect on
  // these coordinates' primitive values, not on this object's identity.
  const vendorLatLng =
    vendor?.location_lat != null && vendor?.location_lng != null
      ? { lat: vendor.location_lat, lng: vendor.location_lng }
      : null;
  const destinationLatLng =
    activeAddress?.location_lat != null && activeAddress?.location_lng != null
      ? { lat: activeAddress.location_lat, lng: activeAddress.location_lng }
      : null;
  const deliveryFeeEstimate = useDeliveryFeeEstimate(vendorLatLng, destinationLatLng, subtotalKobo);

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
          serviceFeeKobo={serviceFeeKobo}
          walletBalanceKobo={walletBalanceKobo}
          deliveryFeeEstimate={deliveryFeeEstimate}
          deliveryNote={deliveryNote}
          onDeliveryNoteChange={setDeliveryNote}
          customerPhone={customerPhone}
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
          serviceFeeKobo={serviceFeeKobo}
          walletBalanceKobo={walletBalanceKobo}
          deliveryFeeEstimate={deliveryFeeEstimate}
          deliveryNote={deliveryNote}
          onDeliveryNoteChange={setDeliveryNote}
          customerPhone={customerPhone}
          formAction={formAction}
          formState={formState}
          pending={pending}
        />
      </div>
    </>
  );
}
